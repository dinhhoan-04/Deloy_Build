"""Post-LLM correspondence checks: orphan paperIds, duplicate titles.

Principle: never auto-fix orphan references — silently rewriting which paper
a claim cites would produce wrong verify results. Drop the claim and warn.
"""

from __future__ import annotations
import re

_DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s]+)", re.IGNORECASE)


def _clean_doi(raw: str | None) -> str | None:
    """Extract the DOI prefix only, stripping trailing reference numbers or junk.

    E.g. "10.1002/pro.7018219" where "19" is a reference counter → "10.1002/pro.70182"
    is not detectable post-hoc, but we can at least strip trailing whitespace and
    extract the first DOI-shaped token from a potentially polluted string.
    """
    if not raw:
        return None
    raw = raw.strip()
    m = _DOI_RE.search(raw)
    if not m:
        return None
    return m.group(1).rstrip(".")


def _norm_title(t: str) -> str:
    return " ".join(t.lower().split())


_HOST_DOMAINS = ("elicit.com", "scispace.com", "consensus.app")


def _is_host_url(u: str | None) -> bool:
    if not u:
        return False
    s = u.lower()
    return any(d in s for d in _HOST_DOMAINS)


def validate_correspondence(raw: dict, *, host_url: str | None = None) -> tuple[dict, list[str]]:
    papers = list(raw.get("papers", []))
    claims = list(raw.get("claims", []))
    warnings: list[str] = []

    # 0. Clean DOIs on all papers.
    for p in papers:
        p["doi"] = _clean_doi(p.get("doi"))

    # 0b. Drop papers that are actually the host page itself, or have no
    #     usable identifier (no DOI AND no external URL). The LLM sometimes
    #     emits the current search/result page as a "paper" — reject those
    #     so downstream verify doesn't try to verify a claim against the page
    #     it was extracted from.
    surviving: list[dict] = []
    for p in papers:
        url = p.get("url")
        if _is_host_url(url) or (host_url and url and url.rstrip("/") == host_url.rstrip("/")):
            warnings.append(f"dropped_host_paper: {p.get('id')} url={url}")
            continue
        surviving.append(p)
    papers = surviving

    # 1. Merge duplicate titles (different ids, same normalized title).
    title_to_canonical: dict[str, str] = {}
    id_remap: dict[str, str] = {}
    deduped: list[dict] = []
    for p in papers:
        key = _norm_title(p.get("title", ""))
        if not key:
            deduped.append(p)
            continue
        if key in title_to_canonical:
            canonical = title_to_canonical[key]
            id_remap[p["id"]] = canonical
            warnings.append(f"merged_duplicate_paper: {p['id']} -> {canonical} (same title)")
        else:
            title_to_canonical[key] = p["id"]
            deduped.append(p)
    papers = deduped

    valid_ids = {p["id"] for p in papers}

    # 2. Remap and validate claims.
    kept: list[dict] = []
    for c in claims:
        # Remap and dedupe within-claim references.
        seen: set[str] = set()
        remapped: list[str] = []
        for pid in c.get("paperIds", []):
            mapped = id_remap.get(pid, pid)
            if mapped in seen:
                continue
            seen.add(mapped)
            remapped.append(mapped)
        # Drop the claim if ANY reference is orphan.
        orphans = [pid for pid in remapped if pid not in valid_ids]
        if orphans:
            warnings.append(f"dropped_orphan_claim: {c['id']} referenced {','.join(orphans)}")
            continue
        kept.append({**c, "paperIds": remapped})

    return {"papers": papers, "claims": kept}, warnings
