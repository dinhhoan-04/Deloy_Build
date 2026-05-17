import pytest


@pytest.mark.asyncio
async def test_md_export_has_yaml_frontmatter(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]

    r = await client_dev_alice.post(
        "/v1/drafts",
        json={
            "project_id": pid,
            "title": "My Draft",
            "markdown": "# Hello\n\nWorld",
        },
    )
    did = r.json()["id"]

    r = await client_dev_alice.get(f"/v1/drafts/{did}/export", params={"format": "md"})
    assert r.status_code == 200
    content = r.text
    assert content.startswith("---\n")
    assert "title: My Draft" in content
    assert "date:" in content


@pytest.mark.asyncio
async def test_docx_export_has_date(client_dev_alice):
    import io
    from docx import Document

    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]

    r = await client_dev_alice.post(
        "/v1/drafts",
        json={
            "project_id": pid,
            "title": "Doc Draft",
            "markdown": "Some body",
        },
    )
    did = r.json()["id"]

    r = await client_dev_alice.get(f"/v1/drafts/{did}/export", params={"format": "docx"})
    assert r.status_code == 200

    doc = Document(io.BytesIO(r.content))
    full_text = " ".join(p.text for p in doc.paragraphs)
    assert "Last updated:" in full_text
