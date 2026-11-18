"""Household checks on POST /api/batch (src/integrity.py): registry fields,
references, subtask rules and safe deletes."""

import pytest

from tests.samples import samples
from tests.test_api import batch, ref


@pytest.fixture()
def recs(client, sub):
    r = samples(sub)
    assert batch(client, put=r.values()).status_code == 200
    return r


def refused(client, msg, put=(), delete=()):
    res = batch(client, put=put, delete=delete)
    assert res.status_code == 400, res.text
    assert msg in res.json()["detail"], res.json()["detail"]


# ── registry fields ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name,patch,msg",
    [
        ("person", {"attributes": {"birthYear": 1980.5}}, "birthYear must be a whole number"),
        ("person", {"attributes": {"shoeSize": 42}}, "unknown field 'shoeSize'"),
        ("car", {"attributes": {"odometer": 1}}, "plate is required"),
        ("car", {"attributes": {"plate": "1", "odometer": "far"}}, "odometer must be a number"),
        ("trip", {"attributes": {"start": "2027-04-08", "end": "2027-04-01"}}, "end must be on or after start"),
        ("trip", {"attributes": {"start": "2027-04-01", "end": "2027-04-08", "travelers": ["c_1"]}}, "must refer to a person"),
        ("trip", {"attributes": {"start": "2027-04-01", "end": "2027-04-08", "travelers": ["p_ghost"]}}, "missing subject 'p_ghost'"),
        ("document", {"fields": {"nationality": 3}}, "nationality must be text"),
        ("document", {"fields": {"issueDate": "May 2020"}}, "issueDate must be a date"),
        ("document", {"fields": {"providerId": "k_1"}}, "unknown field 'providerId'"),
        ("reservation", {"fields": {"link": "example.com"}}, "link must be an http(s) link"),
    ],
)
def test_field_rules(client, recs, name, patch, msg):
    refused(client, msg, put=[{**recs[name], **patch}])


def test_unknown_subject_type(client, recs):
    refused(client, "unknown subject type 'boat'", put=[{**recs["person"], "id": "p_boat", "subjectType": "boat"}])


def test_unique_plate(client, recs):
    twin = {**recs["car"], "id": "c_2", "name": "Mazda 3 (2)", "attributes": {"plate": "1234567"}}
    refused(client, "plate '1234567' is already used by Mazda 3", put=[twin])


def test_provider_must_have_a_matching_tag(client, recs, sub):
    mechanic = {**recs["contact"], "id": "k_2", "name": "Joe", "tags": ["cars"], "links": []}
    health = {**recs["document"], "id": "d_9", "category": "health", "type": "Result", "files": [], "fields": {"providerId": "k_2"},
              "customFields": [], "assignmentId": None, "expiry": None}
    refused(client, "Joe isn't tagged health or other", put=[mechanic, health])


# ── what a subject allows ───────────────────────────────────────────────────


def test_subject_allows(client, recs):
    refused(client, "a person can't hold reservations", put=[{**recs["reservation"], "subjectId": "p_ronen"}])
    refused(client, "a trip can't hold assignments", put=[{**recs["assignment"], "subjectId": "tr_1"}])
    refused(client, "a car can't hold 'identity' documents",
            put=[{**recs["document"], "subjectId": "c_1", "assignmentId": None}])
    refused(client, "a car can't have identity routines", put=[{**recs["assignment"], "subjectId": "c_1"}])


def test_document_rules(client, recs):
    refused(client, "type 'Library card' isn't a identity type", put=[{**recs["document"], "type": "Library card"}])
    refused(client, "file role 'side' isn't used", put=[{**recs["document"], "files": [{**recs["document"]["files"][0], "role": "side"}]}])
    two_fronts = [recs["document"]["files"][0], recs["document"]["files"][0]]
    refused(client, "each file role may be used once", put=[{**recs["document"], "files": two_fronts}])
    refused(client, "file documents don't expire", put=[{**recs["attachment"], "expiry": {"validUntil": "2030-01-01", "outdated": False}}])
    refused(client, "attached to a missing reservation", put=[{**recs["attachment"], "attachedTo": {"kind": "reservation", "id": "res_x"}}])


def test_document_routine_link(client, recs):
    car_routine = {**recs["routine"], "id": "r_car", "area": "car"}
    car_assignment = {**recs["assignment"], "id": "a_car", "routineId": "r_car", "subjectId": "c_1", "supply": None}
    car_doc = {**recs["document"], "id": "d_car", "subjectId": "c_1", "category": "car", "type": "Policy", "files": [],
               "fields": {}, "customFields": [], "assignmentId": "a_1"}
    refused(client, "its routine belongs to another subject", put=[car_routine, car_assignment, car_doc])
    health_doc = {**recs["document"], "id": "d_h", "category": "health", "type": "Result", "files": [], "fields": {},
                  "customFields": [], "expiry": None}
    refused(client, "link a health routine to a health document", put=[health_doc])


# ── tasks and subtasks ──────────────────────────────────────────────────────


def test_subtask_rules(client, recs):
    grandchild = {**recs["subtask"], "id": "t_3", "parentId": "t_2"}
    refused(client, "is itself a subtask (one level only)", put=[grandchild])
    refused(client, "parent task 't_x' doesn't exist", put=[{**recs["subtask"], "parentId": "t_x"}])
    refused(client, "a subtask must have its parent's subject", put=[{**recs["subtask"], "subjectId": "c_1"}])
    other = {**recs["task"], "id": "t_9", "source": None, "appointment": None}
    refused(client, "it has subtasks, so it can't be a subtask", put=[other, {**recs["task"], "parentId": "t_9", "source": None, "appointment": None}])


def test_moving_a_parent_moves_its_subtasks(client, recs):
    plain = {**recs["task"], "source": None, "appointment": None}
    batch(client, put=[plain])
    refused(client, "its subtasks (t_2) must move to the same subject", put=[{**plain, "subjectId": None}])
    assert batch(client, put=[{**plain, "subjectId": None}, {**recs["subtask"], "subjectId": None}]).status_code == 200


def test_task_source_must_match(client, recs):
    refused(client, "same subject as its source assignment", put=[{**recs["task"], "subjectId": "c_1", "appointment": None}])
    refused(client, "source reservation 'res_x' doesn't exist",
            put=[{**recs["task"], "id": "t_b", "subjectId": "tr_1", "appointment": None, "source": {"kind": "reservation", "id": "res_x", "step": "book"}}])


# ── safe deletes ────────────────────────────────────────────────────────────


def test_delete_referenced_record_is_refused(client, recs):
    refused(client, "task t_1 is still referenced by task t_2", delete=[ref(recs["task"])])
    refused(client, "subject p_ronen is still referenced", delete=[ref(recs["person"])])
    refused(client, "reservation res_1 is still referenced by document d_2", delete=[ref(recs["reservation"])])
    refused(client, "contact k_1 is still referenced", delete=[ref(recs["contact"])])


def test_delete_with_dependents_in_the_same_batch(client, recs):
    assert batch(client, delete=[ref(recs["task"]), ref(recs["subtask"])]).status_code == 200
    assert batch(client, delete=[ref(recs["reservation"]), ref(recs["attachment"])]).status_code == 200
    # The trip is still a traveler-less container; the person is still a traveler of it.
    refused(client, "subject p_ronen is still referenced by subject tr_1", delete=[ref(recs["person"]), ref(recs["document"]),
            ref(recs["assignment"]), ref(recs["contact"])])
