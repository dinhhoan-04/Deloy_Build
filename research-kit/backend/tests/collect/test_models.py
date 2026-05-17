from app.db.models import Base, AggregateClaim


def test_models_register_on_metadata():
    tables = set(Base.metadata.tables.keys())
    assert {
        "aggregate_sessions",
        "aggregate_claims",
        "aggregate_references",
        "google_tokens",
    } <= tables


def test_claim_has_vector_column():
    cols = {c.name for c in AggregateClaim.__table__.columns}
    assert "embedding" in cols
