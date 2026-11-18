"""A small valid v2 household: one record per kind, plus a subtask and an
attachment, with every kind of reference in use."""

TS = "2026-11-01T10:00:00.000Z"


def base(kind: str, id: str) -> dict:
    return {"kind": kind, "id": id, "createdAt": TS, "updatedAt": TS, "archived": False}


def samples(sub: str) -> dict[str, dict]:
    prefix = f"u/{sub}/"
    file_ref = {"key": f"{prefix}abc/passport.pdf", "name": "passport.pdf", "contentType": "application/pdf", "size": 1234}
    ticket = {"key": f"{prefix}def/ticket.pdf", "name": "ticket.pdf", "contentType": "application/pdf", "size": 99}
    return {
        "person": {**base("subject", "p_ronen"), "subjectType": "person", "name": "Ronen", "notes": "",
                   "attributes": {"birthYear": 1980}},
        "car": {**base("subject", "c_1"), "subjectType": "car", "name": "Mazda 3", "notes": "",
                "attributes": {"plate": "12-345-67", "odometer": 45210.5}},
        "trip": {**base("subject", "tr_1"), "subjectType": "trip", "name": "Lisbon", "notes": "",
                 "attributes": {"destination": "Lisbon, Portugal", "start": "2027-04-01", "end": "2027-04-08", "travelers": ["p_ronen"]}},
        "contact": {**base("contact", "k_1"), "name": "Dr. Levi", "role": "Family doctor", "phone": "+972-50-0000000",
                    "email": "", "notes": "", "tags": ["health"], "links": [{"subjectId": "p_ronen", "role": "Family doctor"}]},
        "routine": {
            **base("routine", "r_1"), "area": "identity", "template": "passport", "icon": "passport", "title": "Passport",
            "description": "Renew before it expires", "dateLabel": "Expires",
            "plan": [{"title": "Book renewal appointment", "offsetDays": -90, "kind": "schedule", "prep": "Bring photos", "requestsDocument": None}],
            "followUps": [{"title": "File the new passport", "offsetDays": 0, "kind": "plain", "prep": "",
                           "requestsDocument": {"category": "identity", "type": "Passport"}}],
            "repeatMonths": 120, "countFrom": "due", "extension": None,
        },
        "assignment": {
            **base("assignment", "a_1"), "routineId": "r_1", "subjectId": "p_ronen", "date": "2027-03-01",
            "repeatMonths": None, "done": False, "contactId": "k_1",
            "supply": {"onHand": 28, "asOf": "2026-11-01", "perDay": 0.5, "unit": "pills", "perRefill": 30, "refillsLeft": 2, "orderLeadDays": 5},
            "history": [{"date": "2026-01-01", "text": "Renewed"}], "plan": None, "countFrom": None,
        },
        "task": {
            **base("task", "t_1"), "subjectId": "p_ronen", "parentId": None, "title": "Book renewal appointment", "notes": "",
            "date": "2026-12-01", "order": 1731000000000, "done": False, "doneAt": None,
            "source": {"kind": "assignment", "id": "a_1", "step": "schedule"},
            "appointment": {"time": "09:30", "providerId": "k_1", "providerNote": "", "prep": "Photos"},
            "requestsDocument": None,
        },
        "subtask": {
            **base("task", "t_2"), "subjectId": "p_ronen", "parentId": "t_1", "title": "Fill in the DS-82 form", "notes": "",
            "date": "2026-11-20", "order": 12.5, "done": False, "doneAt": None, "source": None, "appointment": None,
            "requestsDocument": None,
        },
        "document": {
            **base("document", "d_1"), "subjectId": "p_ronen", "attachedTo": None, "category": "identity", "type": "Passport",
            "title": "Passport", "date": None, "files": [{"role": "front", "file": file_ref}],
            "fields": {"idNumber": "12345678", "issuer": "Israel", "issueDate": "2020-05-01", "placeOfBirth": "Haifa"},
            "customFields": [{"label": "Hair", "value": "Brown"}], "assignmentId": "a_1", "pinned": True,
            "expiry": {"validUntil": "2030-05-01", "outdated": False},
        },
        "reservation": {
            **base("reservation", "res_1"), "subjectId": "tr_1", "type": "flight", "title": "TLV → LIS",
            "start": "2027-04-01T06:30", "end": "2027-04-01T11:00", "status": "booked", "bookBy": None, "checkinReminder": True,
            "fields": {"confirmation": "ABC123", "link": "https://example.com"},
        },
        "attachment": {
            **base("document", "d_2"), "subjectId": "tr_1", "attachedTo": {"kind": "reservation", "id": "res_1"},
            "category": "attachment", "type": "File", "title": "ticket.pdf", "date": None,
            "files": [{"role": None, "file": ticket}], "fields": {}, "customFields": [], "assignmentId": None,
            "pinned": False, "expiry": None,
        },
    }
