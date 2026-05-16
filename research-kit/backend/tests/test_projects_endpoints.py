import pytest


@pytest.mark.asyncio
async def test_projects_crud(client_dev_alice, client_dev_bob):
    r = await client_dev_alice.post("/v1/projects", json={"name": "Lit Review"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r2 = await client_dev_alice.get("/v1/projects")
    assert any(p["id"] == pid for p in r2.json())

    # Bob cannot see Alice's project
    r3 = await client_dev_bob.get("/v1/projects")
    assert all(p["id"] != pid for p in r3.json())

    r4 = await client_dev_alice.patch(f"/v1/projects/{pid}", json={"name": "Renamed"})
    assert r4.json()["name"] == "Renamed"

    # Bob cannot delete Alice's project (404, not 403, to avoid leaking existence)
    r5 = await client_dev_bob.delete(f"/v1/projects/{pid}")
    assert r5.status_code == 404

    r6 = await client_dev_alice.delete(f"/v1/projects/{pid}")
    assert r6.status_code == 204
