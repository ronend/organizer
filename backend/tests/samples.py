"""One valid record per entity kind, matching frontend/src/types/coo.ts."""

TS = "2026-11-01T10:00:00.000Z"


def base(kind: str, id: str) -> dict:
    return {"kind": kind, "id": id, "createdAt": TS, "updatedAt": TS}


def samples(sub: str) -> dict[str, dict]:
    prefix = f"u/{sub}/"
    file_ref = {
        "key": f"{prefix}abc/passport.pdf",
        "name": "passport.pdf",
        "contentType": "application/pdf",
        "size": 1234,
    }
    return {
        "person": {**base("person", "p_ronen"), "name": "Ronen", "birthYear": 1980},
        "car": {**base("car", "c_1"), "makeModel": "Mazda 3", "plate": "12-345-67", "odometer": 45210.5},
        "contact": {
            **base("contact", "k_1"),
            "name": "Dr. Levi",
            "role": "Family doctor",
            "phone": "+972-50-0000000",
            "group": "health",
            "notes": "",
        },
        "routine": {
            **base("routine", "r_1"),
            "area": "identity",
            "template": "passport",
            "icon": "passport",
            "title": "Passport",
            "description": "Renew before it expires",
            "dateLabel": "Expires",
            "plan": [
                {
                    "title": "Book renewal appointment",
                    "offsetDays": -90,
                    "kind": "schedule",
                    "prep": "Bring photos",
                    "docTask": None,
                }
            ],
            "followUps": [
                {
                    "title": "File the new passport",
                    "offsetDays": 0,
                    "kind": "plain",
                    "prep": "",
                    "docTask": {"docKind": "identity", "docType": "Passport"},
                }
            ],
            "repeatMonths": 120,
            "countFrom": "due",
            "medication": False,
        },
        "assignment": {
            **base("assignment", "a_1"),
            "routineId": "r_1",
            "subjectType": "person",
            "subjectId": "p_ronen",
            "date": "2027-03-01",
            "repeatMonths": None,
            "done": False,
            "contactId": None,
            "supply": {
                "onHand": 28,
                "asOf": "2026-11-01",
                "perDay": 0.5,
                "unit": "pills",
                "perRefill": 30,
                "refillsLeft": 2,
                "orderLeadDays": 5,
            },
            "history": [{"date": "2026-01-01", "text": "Renewed"}],
            "plan": None,
            "countFrom": None,
        },
        "task": {
            **base("task", "t_1"),
            "title": "Book renewal appointment",
            "notes": "",
            "date": "2026-12-01",
            "order": 1731000000000,
            "done": False,
            "doneAt": None,
            "subjectType": "person",
            "subjectId": "p_ronen",
            "assignmentId": "a_1",
            "stepKind": "schedule",
            "appointment": {"time": "09:30", "providerId": "k_1", "providerNote": "", "prep": "Photos"},
            "tripId": None,
            "reservationId": None,
            "tripTask": None,
            "docTask": None,
            "subtasks": [
                {"id": "st_1", "title": "Find two passport photos", "done": True, "date": None},
                {"id": "st_2", "title": "Fill in the DS-82 form", "done": False, "date": "2026-11-20"},
            ],
        },
        "document": {
            **base("document", "d_1"),
            "docKind": "identity",
            "subjectType": "person",
            "subjectId": "p_ronen",
            "name": "Passport",
            "type": "Passport",
            "date": None,
            "validUntil": "2030-05-01",
            "idNumber": "12345678",
            "issuer": "Israel",
            "issueDate": "2020-05-01",
            "details": [{"name": "Place of birth", "value": "Haifa"}],
            "front": file_ref,
            "back": None,
            "providerId": None,
            "about": "",
            "episode": "",
            "file": None,
            "assignmentId": "a_1",
            "pinned": True,
            "archived": False,
            "outdated": False,
        },
        "trip": {
            **base("trip", "tr_1"),
            "name": "Lisbon",
            "destination": "Lisbon, Portugal",
            "start": "2027-04-01",
            "end": "2027-04-08",
            "travelers": ["p_ronen"],
            "notes": "",
        },
        "reservation": {
            **base("reservation", "res_1"),
            "tripId": "tr_1",
            "type": "flight",
            "title": "TLV → LIS",
            "start": "2027-04-01T06:30",
            "end": "2027-04-01T11:00",
            "address": "",
            "confirmation": "ABC123",
            "link": "https://example.com",
            "files": [file_ref],
            "status": "booked",
            "bookBy": None,
            "details": "",
            "checkinReminder": True,
        },
    }
