# coo: UI/UX specification

Nov 8, 2026 · @Ronen Dancziger

## Overview and design principles

coo is a personal “chief of operations” web app: a secretary for one household that tracks what repeats, what expires and what is coming, and brings it all to one agenda. It manages three kinds of things: people (health and identity documents), cars (insurance, inspection, registration, service, glovebox documents) and trips (a timeline of reservations). Ad-hoc tasks cover everything else.

This document describes what the user sees and does. Build it as a responsive single-page web app. A working clickable prototype exists; where this spec is silent, match the prototype’s behavior. Data in the prototype lives in memory and resets on reload; the real app must persist everything.

**Principles**

1. **Subjects are entry points.** Home shows one same-size card per person, car and trip. A card carries status only (counts and icons), never details. Tapping it opens the subject.
2. **Create once, assign to many.** A routine is written once and assigned to several people or cars, each with its own date and status.
3. **Dates drive everything.** An expiry or due date produces steps, steps become tasks, tasks land on the Agenda and in the card counts.
4. **Show, don’t hunt.** Documents, IDs and tickets open full screen with one tap, ready to hold up to an officer or a gate scanner.
5. **Quiet interface.** Flat surfaces, hairline dividers, one soft tint. Color is reserved for status.
6. **Nothing destructive without a way back.** Deleting, archiving and drag moves all offer Undo.
7. **Touch first.** Every control is at least 44 px tall on touch screens, and every drag has a keyboard equivalent.
8. **Privacy by default.** ID numbers are masked in lists. Health and identity content stays inside the person’s own pages.

**Target visual direction.** Use the lighter skin described in the design system section: borderless tinted tiles, flat lists with dividers, status shown as a dot and a word. An earlier skin used outlined cards and filled pills; it is not the target.

## Navigation and information architecture

Desktop uses a fixed left sidebar; below 820 px it becomes a bottom tab bar. The page map is two levels deep: global pages, then pages that belong to one selected person or car.

**Desktop sidebar** (240 px wide, sticky, full height, scrolls if long)

- Brand: a 24 px rounded square with the letter “c”, then “coo”.
- Global items: Home, Agenda, Trips, Routines. Agenda shows a small red count badge: open tasks that are overdue or due today.
- Group “People”: one row per person (icon, name, and a small sub-label “Age 41”), then “+ Add person”.
- Group “Cars”: one row per car (icon, make and model, plate as sub-label), then “+ Add car”.
- A group titled with the selected subject’s name, listing that subject’s pages. Person: Overview, Health, Identity. Car: Overview, Documents.
- Group “Shared”: Contacts.
- The current page has a thin 2 px accent marker on its left edge, bold text and an accent icon. The selected person or car is bold with an accent icon.

**Mobile tab bar** (fixed bottom, safe-area aware)

- Five tabs: Home, Agenda (with badge), Trips, Routines, Contacts.
- Subject pages (Overview, Health, Identity, Documents) have no tab. Reach them from Home cards. At the top of each subject page show a horizontally scrolling row of chips (name, plus plate or age) for every person and car, with a “+” chip that opens a Person or Car chooser. Under it, a segmented control switches that subject’s pages.

**Page map**

- Home
- Agenda
- Trips
  - Trip page (timeline)
- Routines (all routines)
- Person (opened from Home or the sidebar)
  - Overview
  - Health (routines and treatment history)
  - Identity (IDs and renewals)
- Car
  - Overview (routines, appointments, tasks)
  - Documents (glovebox)
- Contacts

Modals and full-screen viewers sit on top of pages: Add task, task detail, routine form, routine detail, document and ID forms, reservation form and detail, trip form, document and ticket viewers.

**Navigation rules**

- Opening a person or car from Home or the sidebar lands on its Overview.
- Switching subject while on Health or Identity keeps a person on that page. Switching to a car lands on its Documents, and switching from a car to a person lands on Health.
- The Trips item stays active while on a trip page; the trip page has a “← All trips” link at the top.
- Every page change scrolls to the top.
- Cross-links: a trip traveler chip opens that person’s Identity page; a trip task opens its trip; a routine’s assignee chip opens that assignee’s routine detail; a Home trip card opens the trip.

## Visual design system

The app follows the system light or dark setting. Surfaces are flat: no shadows, almost no borders. Structure comes from whitespace, thin dividers and one soft tint.

**Color tokens**

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| Page background | #FFFFFF | #141618 | Page and dialogs |
| Tint | #F6F5F2 | #1C1F22 | Tiles, inputs, empty states |
| Tint hover | #EFEDE8 | #24282B | Hovered tiles |
| Hairline | #ECEAE5 | #26292D | Dividers, outlines |
| Text | #1E2226 | #E8E9EA | Body and titles |
| Muted text | #6B7075 | #9A9FA4 | Meta lines, labels |
| Accent | #2F566B | #8FB1C4 | Primary button, links, current page |
| Accent soft | #EEF3F6 | #1F2A31 | Selected chips |
| On accent | #FFFFFF | #10202A | Text on primary button |
| OK (green) | #2F6B3F on #E9F3EC | #8FC09B on #1E2B23 | Valid, on track, done |
| Warning (amber) | #7A5A10 on #F7F0DC | #D9B766 on #2E2819 | Due soon, not booked |
| Bad (red) | #8C3730 on #F8E8E5 | #E0948C on #2F2020 | Overdue, expired |
| Info (blue) | #2F566B on #E9F0F4 | #8FB1C4 on #1F2A31 | Booked, upcoming |

Status meaning is consistent everywhere: green is fine, amber needs action soon, red is late or expired, blue is scheduled, grey outline is “no schedule”.

**Type.** Inter with a system fallback. Base 14.5 px. Page title 24 px semibold (22 px on mobile). Section headings 13 px semibold in sentence case, with the count in muted text on the right. Meta text 12.5 px muted. Use only weights 400, 500 and 600.

**Layout.** Main column is at most 860 px wide, padded 44 px top and 48 px sides (24 px and 18 px on mobile), and leaves 100 px at the bottom (120 px on mobile for the tab bar). Sections are 30 px apart. Corner radius: tiles 14 px, dialogs 18 px, inputs 10 px, buttons 8 px.

**Components**

- **Buttons.** Primary is solid accent. Secondary is a hairline outline on transparent. Ghost has no outline and is used for quiet actions such as Edit and Delete. Small buttons are 34 px high on desktop. All buttons are 44 px on touch devices (40 px for small).
- **Status.** A 7 px dot in the status color followed by a word in the same color. No filled pills.
- **Count circle.** A 22 px circle with the status tint holding a number or a check, followed by a 20 px icon in the same color. Used on Home tiles. Text lives only in a tooltip and screen-reader text.
- **Lists.** Flat rows on the page background, a hairline above the list and between rows, no box. Rows are at least 56 px high.
- **Tiles.** Tint background, no border, darker on hover. Used for Home cards, routine cards, contact cards, area tiles.
- **Inputs.** Tint fill with a transparent border; focus shows a 2 px accent outline. Labels sit above in muted 13 px.
- **Segmented control.** Text buttons with no track; the selected one has a tint fill.
- **Filter chips.** Outlined pills; the selected one gets the accent-soft fill and an accent border.
- **Icons.** Line icons, 1.8 px stroke, 18 to 22 px: home, calendar, repeat, document, person, car, plus, check, close, download, monitor (show), phone, copy, trash, shield, wrench, stamp, stethoscope, tooth, eye, syringe, flask, pill, bone, ID card, plane, bed, ticket, mountain trail, train, map pin, link, suitcase, bell, alert circle, chevron, grip (six dots).
- **Motion.** Only two animations: the 550 ms ID card flip and the drag ghost in the Agenda. Disable both transitions when the user prefers reduced motion.

## Home

Home answers one question at a glance: who or what needs attention. It is a grid of identical status tiles, each one a doorway into a person, car, trip or the general task list.

**Header.** Small muted date line (“Sunday, November 8”), a greeting as the page title (“Good morning.”, “Good afternoon.” or “Good evening.” by local time), and a primary “Add task” button on the right. There is no stats bar and no “needs attention” banner.

**Section “Everyone and everything”** (count on the right = number of people and cars)

- Grid of tiles, auto-fill with a 230 px minimum, 14 px gaps.
- One tile per person and per car, then a final “General” tile for tasks not tied to anyone.
- Every tile has the same height (112 px; 104 px on mobile). The whole tile is a button.
- Tile top row: an icon (person, car or calendar for General), the name in 15 px semibold, a muted sub-label (“Age 41”, the plate, or “Tasks not tied to anyone”), and a chevron on the right.
- Tile bottom row: status indicators, each a count circle plus an icon, with no visible words:
  - red alert icon: overdue items (open tasks past their date)
  - amber bell: reminders (open non-appointment tasks due today through 14 days ahead)
  - blue calendar: appointments in the next 30 days
- An indicator with a zero count is hidden. If all are zero, show a single green circle with a check.
- Each indicator has a tooltip and hidden text, for example “2 reminders”.
- Tapping a person or car opens its Overview. Tapping General opens the Agenda filtered to General tasks.
- Order: most overdue first, then most due today, then earliest next date. General is always last.

**Section “Trips”** (only upcoming trips, meaning the end date is today or later; hidden if none)

- Same tile size and structure: suitcase icon, trip name, dates (“Dec 1 – Dec 8”), chevron.
- Indicators: a blue circle with days to go plus a plane icon (or a green plane circle labelled “Happening now”), an amber alert circle for reservations not booked yet, and an amber bell for trip reminders due within 14 days.
- Sorted by start date. Tapping opens the trip page.

**Add row.** Three dashed outline tiles at the bottom: “Add person”, “Add car”, “Plan a trip”. They open the matching form.

## Agenda and drag and drop

The Agenda lists every open task across all people, cars, trips and general tasks in four time buckets. Dragging a task between buckets changes its date, and the date adapts to the tasks around the drop spot.

**Header and controls.** Muted line “Everyone and everything”, title “Agenda”, primary “Add task” button. Below it: a segmented control “Open | Done” and a filter select with “Everything”, “General tasks”, then each person and car. There is no stats bar and no inline add form.

**Open tab.** Four sections, always visible, in this order: Overdue, Today, Next 7 days (1 to 7 days ahead), Later (8 or more days ahead). Each has a heading with its count and a flat list. An empty section shows a muted line: “Nothing overdue.”, “Nothing due today. Drag a task here to do it today.”, “Nothing planned for this week.”, “Nothing further out.”

**Task row** (at least 56 px)

- Left: a round checkbox (20 px ring, 44 px touch area).
- Middle: the title, then a muted meta line “\<Person or car> · \<Routine name or Ad-hoc>”. Trip tasks read “\<Trip name> · Trip”. Appointments add “ · Appointment” and the time and provider note. Unscheduled steps add “ · Needs a date”.
- Right: the due label (“Today”, “Tomorrow”, weekday and date within 6 days, “Nov 24”, with the year only if it is another year, or “3 days overdue” in bold red).
- Far right: a six-dot grip handle (44 px target). Hidden for appointments and completed tasks.

**Checkbox behavior by kind of task**

- Plain task: marks done at once, toast “Done · \<title>”.
- Schedule step (“Book dental cleaning”): opens the appointment dialog (date, time, provider, prep notes). Saving completes the step and adds an appointment task on that date. If prep notes were entered and the subject is a person, also add “Prepare: \<notes>” the day before.
- Renewal step: opens “Done. What’s the new expiry date?” (or “When is the next one due?” for interval routines). Saving completes the step, plans the next cycle and adds follow-up tasks. For a routine that does not repeat, it just marks the routine Done.
- Refill pickup step: asks quantity received and refills left, then recalculates the run-out date and plans the next order.
- Trip “Book:” step: opens the reservation form with status Booked preselected.
- Ticking a done task again reopens it.
- Clicking the row body opens the task detail dialog.

**Done tab.** Completed tasks, newest first, title struck through and muted, right label “Done Nov 6”.

**Drag and drop (Open tab only)**

- Press the handle and move more than 5 px to start. The row dims to about 35 percent and a ghost copy (accent outline) follows the pointer.
- The nearest section gets a dashed accent outline and a 3 px accent drop line shows where the task will land.
- The page auto-scrolls when the pointer is within 90 px of the top or bottom of the viewport.
- Works with mouse and touch. Touching the handle must not scroll the page.
- Releasing applies the new date and order, shows a toast (“Moved to today”, “Moved to tomorrow”, “Moved to overdue, Nov 6”, “Moved to Wed, Nov 11” or “Order updated”) with Undo, which restores the old date and order.

**Date rule on drop.** Use the tasks already in the target section, excluding the dragged one.

1. Dropped between two tasks with the same date: take that date and sit between them.
2. Dropped below a task, at the end or before a task on a later day: take the date of the task above.
3. Dropped at the top of a section above a task: take the date of the first task below.
4. Dropped into an empty section: Overdue becomes yesterday, Today becomes today, Next 7 days becomes tomorrow, Later becomes 8 days from now.
5. Tasks on the same day keep the order the user set. Order is a secondary sort after date.

Moving a routine step changes only that step’s date. Booked appointments cannot be dragged.

**Keyboard.** Focus the handle and press Up or Down to move the task one position in the combined list, across section boundaries. Focus stays on the handle.

## Add task widget and task detail

There is one way to add a task from the main pages: the “Add task” button in the header of Home and Agenda. It opens a dialog.

**Add task dialog.** Bottom sheet on mobile, centered 560 px dialog on screens from 700 px wide. Eyebrow “New task”, title “Add a task”, close button.

| Field | Behavior |
| --- | --- |
| What needs doing | Required text. |
| Due date | Date input, defaults to today. Beside it, quick-pick chips: Today, Tomorrow, Next week (sets the date). |
| For | Select: “General, no one in particular”, then each person and car with its sub-label. Preselected to the person or car in the Agenda filter, otherwise General. |
| Routine (optional) | Disabled with “Choose a person or car first” while For is General. Otherwise lists that subject’s routines, first option “None, a one-off task”, or “No routines for this one yet”. Changing For refreshes this list. |
| Notes (optional) | Free text. |

Buttons: Cancel (ghost) and Add task (primary). On save the dialog closes, the task appears in its Agenda bucket and a toast says “Added to your agenda”. A task linked to a routine also appears among that routine’s steps and takes the routine’s person or car.

**Other places that create tasks**

- Each person’s and car’s Overview has a small inline form (title, date, Add) that creates a task for that subject.
- A routine’s detail dialog has an “Add a step” mini form (title, date).
- Routine rules and trip reservations generate tasks automatically (see those sections).

**Task detail dialog** (opened by clicking a task row)

- Eyebrow: “\<Person or car> · \<Routine or Ad-hoc>” or “\<Trip> · Trip”. Title: the task title.
- Appointment tasks show their time and provider note, plus the prep note if any.
- Fields: Due date, Notes. Ad-hoc tasks also get an editable Title and a For select (including General).
- Snooze: buttons “1 day” and “1 week” move the date immediately and show a toast.
- Buttons: Delete (ghost, toast with Undo), Open trip (trip tasks), Add document (routine “file the new document” tasks), Save, and a primary action whose label depends on the task: Mark done, Schedule appointment, Mark renewed, Mark done and set next date, Log refill picked up, or Reopen.

## People and cars

People and cars share a page pattern: a header with a muted sub-label above the name (age or plate), a switcher row on mobile, and a segmented control for the subject’s pages. A person’s pages are split into Health and Identity so medical history never mixes with ID documents.

**Person pages: Overview | Health | Identity**

*Overview*

- A block with a person icon, the name, “Age 41” and an Edit ghost button (name, optional birth year).
- “Upcoming appointments” list (hidden when empty), then “Tasks” with this person’s ad-hoc open tasks and the inline add form.
- “Areas”: two tiles, Health and Identity, in the Home tile style. Each shows an icon, the title, “3 routines · 5 documents” and the same count-and-icon status indicators computed from that area’s tasks. Click opens the area.

*Health*

1. “Health routines” heading with an “Add routine” link, a grid of routine cards, and a dashed “Assign an existing routine” tile.
2. “Keep handy” tiles for pinned health documents (tap to show full screen).
3. “Treatment history” heading with an “Add document” link. A segmented control Timeline | List. In Timeline view, episode filter chips (All plus each episode, such as “Knee injury”). A search field covering names, types, notes, providers and episodes.
4. Timeline: entries grouped under month labels on a thin vertical line with a dot per entry. A document entry shows the date, name, type, provider, the one-line “about” text, an episode chip, and Show, Download and Archive actions. A completed appointment shows as “Visit · \<title>” with its note.
5. List view shows the same documents as rows. An “Archive (n)” section with Show/Hide lists archived items with a Restore button.

*Identity.* Described under “Documents, IDs and full-screen viewing”.

**Car pages: Overview | Documents**

- Overview: a block with a car icon, make and model, odometer, the plate in an outlined plate box, and Edit. Then Upcoming appointments, Tasks with inline add, and “Routines” with an “Add routine” link, the card grid and an “Assign an existing routine” tile.
- Documents: “In the glovebox” tiles for pinned documents (Show), “All documents” with an “Add document” link, a search field, and rows showing name, type and linked routine, a validity chip, Show, Download and Archive. Archive section as above.

**Routine card** (grid, 270 px minimum): top row with the routine icon and a status chip; title; description clamped to two lines; schedule line (“Expires Dec 14, 2026 · every 12 months”, “Runs out Nov 21 · 2 refills left”, “No dates or repeats”); “Next: \<step> · \<due>”; “3 documents”. Click opens the routine detail.

**Add or edit a person or car** (dialog)

- Person: Name (required), Birth year (optional, used for age display and age-based reminders).
- Car: Make and model (required), Plate number (required, stored uppercase, must be unique across cars; a duplicate shows a toast “A car with that plate already exists”), Odometer (optional). Make and plate identify the car everywhere.
- A “+” on mobile first asks Person or Car.
- After creating someone new, land on their Overview, show a toast, and immediately open the New routine form with them preselected.

## Routines

A routine is something that recurs or needs tracking: an insurance renewal, a dental cleaning, a passport expiry, a medication supply. The user creates it once and assigns it to one or more people or cars. Each assignee has its own date, steps, documents and status. A routine may be only a title and a note, with no dates at all.

**Routines page** (all routines)

- Header: muted line “Create once, assign to people and cars”, title “Routines”, primary “New routine”.
- One flat list. Each row is one routine shared by its assignees: icon, bold title, description, then a muted summary and area (“Repeats every 6 months · Health”, “No schedule · Car”).
- Under it, one chip per assignee: a colored status dot, the person or car name and its own status text (“Booked · Nov 20”). A chip opens that assignee’s routine detail.
- A dashed “+ Assign” chip and an Edit ghost button open the edit dialog.

**New routine dialog** (wide, 720 px)

1. Intro line: create it once, assign it, a date is optional.
2. **Area** chips: Health, Identity, Car. The area decides which people or cars can be assigned (people for Health and Identity, cars for Car) and which templates are offered. Switching area keeps selected subjects of the matching kind.
3. **Start from** chips: Blank plus the templates of that area (below). Choosing one prefills title, description and schedule.
4. **Title** (required) and **Description** (optional).
5. **Assign to**: a checkbox list of eligible people or cars with sub-labels. At least one is required, otherwise a toast says “Choose at least one person or car”.
6. **Schedule** box with two radios. “No schedule, just a title and a note” is the default for Blank. “Has a due date” reveals: Due date (labelled “Expiry date” in Identity), Repeats (Doesn’t repeat, every 1, 3 or 6 months, every 1, 2, 5, 8 or 10 years). For Blank also: “Remind me (days before)” (14, or 90 in Identity), “Next one counted from” (the day I do it or the due date) and “I need to book an appointment first”. Templates show a sentence describing the planned steps instead.
7. **Preferred contact** (optional) from shared contacts.

The Medication template replaces the schedule box with: on hand now, used per day, unit, quantity per refill, refills left, order N days ahead, and a note that coo tracks supply only and never suggests doses. The run-out date is derived (on hand divided by daily use).

**Templates**

| Area | Templates (steps, relative to the due date) |
| --- | --- |
| Car | Car insurance (compare quotes 30 days before, renew 7 days before); Safety inspection (schedule 14 days before, then the appointment); State registration (renew 14 days before); Regular service (book 21 days before, then the appointment) |
| Health | Annual checkup, Dental cleaning (6 months), Eye exam, Vaccinations, Specialist follow-up (each: book 21 days before, then the appointment, with a “file the visit summary” task after where relevant); Recurring lab tests (schedule 14 days before with a fasting prep note, then “Upload the lab results” and “Book the follow-up visit” after); Medication refill (order, then pick up) |
| Identity | Passport renewal (check requirements and get a photo 210 days before, submit 180 days before); Driver license renewal (60 days before); City or state ID renewal (60 days before). Each adds “Add the new document to documents” after renewal |

**Step kinds.** Plain: just completes. Schedule: completing asks for date, time, provider and prep notes and creates the appointment. Renew: completing asks for the new expiry or next-due date, plans the next cycle and files follow-up tasks. For a routine that does not repeat, completing marks it Done. Pickup: asks quantity and refills left and recalculates the run-out date.

**Routine detail dialog** (wide)

- Eyebrow “\<Person or car> · Routine”, title, description, status chip.
- Fields: the date (labelled Expires, Due, Valid until, Next due or Runs out; optional), Repeats (select), Preferred contact. Changing the date moves all open non-appointment steps by the same number of days. Adding a date to an unscheduled routine generates its steps. Changing Repeats applies at the next renewal.
- Medication shows “Uses 1 tablets per day · 2 refills left · order 7 days ahead” and a “Log a refill” button.
- Button “Edit title, description, assignment” and, if shared, “Also assigned to Maya, Ben”.
- “Steps” list (open first, done struck through) with an inline add-step form.
- “Documents” list with an Add link, and “History” with dated entries (“Passed at Eli’s Auto Service”).

**Edit routine dialog.** Title, description and an “Assigned to” checkbox list. Renaming renames it for everyone. Unchecking someone removes the routine and its steps from them and unlinks their documents; the dialog says so. Newly assigned people or cars start with no date.

**Status text and color**

| Status | Color | When |
| --- | --- | --- |
| Done | Green | A non-repeating routine was completed |
| No schedule | Grey outline dot | No date set |
| Overdue by N days, Expired N days ago, Ran out N days ago | Red | Date is past (wording by area) |
| Booked · Nov 20 | Blue | An appointment exists |
| Runs out in N days | Amber | Within the order lead time plus 3 days |
| Due in N days | Amber | Within 30 days |
| On track, Supply OK | Green | Otherwise |

## Documents, IDs and full-screen viewing

There are three kinds of documents, each with its own form and home: car documents (glovebox), health documents (treatment history) and identity documents (IDs). Every document can be shown full screen, downloaded or archived. Archiving moves it to an “Archive (n)” section with a Restore button; nothing is permanently deleted from the UI.

**Identity page**

- “IDs and documents” heading with an “Add ID or document” link, then a grid of ID cards (300 px minimum).
- “Renewals” heading with “Add routine” and the grid of renewal routine cards, plus “Assign an existing routine”.
- Archive section if any.

**ID card with front and back**

- The top of the card is a flip card, aspect ratio 1.586 (credit-card shape), rounded, on a tint background. It shows the front image, scaled to fit without cropping. A missing side shows an ID icon and “No front image yet” or “No back image yet”.
- Clicking it, or pressing Enter or Space when focused, flips it 180 degrees around the vertical axis over 550 ms to show the back. The flip state is remembered while the user moves around. Without images the flip still works between the two placeholders.
- Under the image: the name in semibold with the validity chip on the right (green “Valid until Dec 1, 2030”; amber “Expires in N days” within 90 days; red “Expired”; an “Outdated” amber chip after a renewal replaced it); a muted line “Passport · U.S. Department of State”; “No. •••• 4492 · Issued Mar 3, 2020 · Expires Dec 1, 2030”.
- A link line “Renewal: Due in 30 days” that opens the renewal routine, or “No renewal reminder”.
- Actions: Show (primary), Edit, Download, Archive.

**Add or edit ID dialog**

| Field | Notes |
| --- | --- |
| Name | Required, for example “Alex’s passport”. |
| Type | Passport, Driver license, City or state ID, Birth certificate, Social Security card, Visa or residence card, Other. |
| ID number | Optional. Masked to the last four digits in lists. |
| Issued by, Issue date, Expiry date | Optional. |
| More details | Name and value rows, pre-filled with field names that depend on the type (Passport: Full name, Nationality, Place of birth, Date of birth. Driver license: Full name, Class, Restrictions and endorsements, Date of birth. City or state ID: Full name, Date of birth. Birth certificate: Full name, Place of birth, Date of birth. Social Security card: Full name. Visa or residence card: Full name, Category, Nationality). Changing the type swaps the suggested rows and keeps values already typed. “+ Add another field” adds a free row. Rows with an empty name or value are dropped on save. |
| Front image, Back image | Image uploads. When editing, choosing a file replaces the current one; a checkbox removes it. A hint says clicking a card anywhere flips it. |
| Linked renewal routine | Select among this person’s Identity routines. |
| Remind me to renew it | Shown when no routine is linked; ticked by default for a new ID. Start reminding me N days before expiry, defaulting by type (Passport 180, Driver license 60, City or state ID 60, otherwise 90) and updated when the type changes. Needs an expiry date. |
| Keep handy | Pins it. |

Saving with the reminder box ticked creates a renewal routine for that person with steps planned backwards from the expiry (a passport gets an extra “Check renewal requirements and get a photo” step 30 days earlier). A toast says “Saved. Renewal reminders planned from \<date>.” Editing the expiry of an ID linked to a routine moves that routine’s open steps by the same amount, unless the ID is already outdated.

**Renewal flow.** Completing the renewal step asks for the new expiry date. The old document is flagged Outdated, and a task “Add the new passport to documents” appears with an Add document button. Saving the new ID linked to the same routine and type archives the older one and closes that task.

**Full-screen viewer (“Show”)**

- Overlay covering the screen with a top bar: Close on the left, the document name centered, Download on the right. Esc closes it.
- A large card: type label, the name as a heading, then for IDs the big flip card (hint “Click the card to flip it”), then a definition list with 24 px values (full ID number, issuer, dates, extra fields), then a validity banner (green, amber within 90 days, or red “Expired on …”).
- Car and health documents show the same card with their fields and, if the file is an image, the image.

**Health document form.** File, Name, Type (Result, Referral, Prescription, Visit summary, Imaging, Vaccination record, Insurance, Other), Document date, Provider (from contacts), “What this is about” (one line of context), Episode (existing) or “Or start a new episode” (text), Linked routine, “Keep handy on this page”.

**Car document form.** File, Name, Type (ID card, Policy, Registration, Inspection, Receipt, Photo, Other), Valid until (optional), Linked routine, “Keep in the glovebox”. Saving a new document linked to the same routine and type archives the older one.

**Download.** Saves one file. For IDs with images, a single SVG containing the details and the front and back images; for other documents a summary card, or the original uploaded file.

## Trips

A trip is a dated project with travelers and a timeline built from its reservations: flights, stays, car rentals, activities, hikes, trains and anything else. Each reservation can carry a confirmation number, a link, tickets (PDF or images), an address and notes.

**Trips page.** Muted line “Flights, stays, cars and plans in one timeline”, title “Trips”, primary “New trip”. Two flat lists, “Upcoming” (end date today or later, soonest first) and “Past” (latest first). Each row is one button: suitcase icon, bold name, “Dec 1, 2026 – Dec 8, 2026 · Portugal”, “Alex, Maya, Noa, Ben · 8 reservations”, an amber “2 not booked” status when relevant, and on the right “In 23 days”, “Happening now” or “Ended”.

**Trip page**

- “← All trips” link, then a muted line “Dec 1, 2026 – Dec 8, 2026 · 7 nights · Portugal”, the trip name as title, and on the right Edit trip (ghost) and Add reservation (primary).
- A summary line: “8 reservations · 2 not booked yet” (or “all booked”), plus notes.
- “Travelers and passports”: one chip per traveler with a status dot and text. Green: passport valid until a date. Amber: valid but under 6 months after the trip ends. Red: expires before the trip ends. Grey: no passport on file or no expiry date. Clicking a chip opens that person’s Identity page.
- Segmented control Timeline | By type.

**Timeline view.** One section per day from the trip’s start to its end, extended if any reservation falls outside. Heading “Fri, Dec 4” (plus “· Today” on the current day) with “+ Add · Day 4” on the right; “+ Add” opens the reservation form with that day’s date at 09:00. Inside a day, a flat list:

- Event row: time in a muted 46 px column (24-hour), a type icon, the title with a muted meta line (“Departs · JFK Terminal 1 · Ref XK7P2Q”), an amber “Not booked” status if planned, then icon buttons: ticket (when files or a confirmation number exist) and link (opens in a new tab, tooltip shows the site name).
- A reservation that ends the same day shows a range (“10:00–13:00”).
- A reservation that ends on a later day appears twice: at its start (“Departs”, “Check-in”, “Pick up”) and at its end on the last day (“Arrives”, “Check-out”, “Drop off”). An overnight flight therefore shows its arrival the next morning.
- Hotels and rental cars also add a quiet line on each day in between: “Staying at Hotel Baixa Boutique”, “Car rental · Compact SUV rental”.
- A day with nothing shows “Nothing planned yet”.

**By type view.** Sections Flights, Stays, Car rentals, Activities, Hikes, Trains and transfers, Other (only those that have items), each a flat list with the full date and time range, reference, status and the same icon buttons.

**Reservation types**

| Type | Icon | Start label | End label |
| --- | --- | --- | --- |
| Flight | plane | Departure | Arrival |
| Stay | bed | Check-in | Check-out |
| Car rental | car | Pick-up | Drop-off |
| Activity | ticket | Starts | Ends |
| Hike | trail | Starts | Ends |
| Train or transfer | train | Departure | Arrival |
| Other | map pin | Starts | Ends |

**Reservation form** (wide dialog, opened from Add reservation, a day’s “+ Add”, or a reservation’s Edit)

1. Type chips. Choosing another type refreshes labels and placeholders and keeps what was typed.
2. Title (required), with a type-specific placeholder.
3. Start (date and time, required) and End (optional), labelled per type. If the end is before the start, a toast says so and nothing is saved.
4. Address or location (label varies: airport, trailhead, station).
5. Confirmation or order number, and Link. For hikes the link label mentions an AllTrails trail. The link is trimmed, “https://” is added if missing, and anything that is not http or https is dropped.
6. Tickets and confirmations: multiple PDF or image files. When editing, each existing file has a “Remove” checkbox.
7. Status: Booked, or “Planned, not booked yet”, with an optional “Book by” date.
8. Details (multi-line).
9. For flights: “Remind me to check in online the day before”, ticked by default.

**Reservation detail dialog.** Eyebrow “\<Trip> · Flight”, title, a status line (green Booked or amber Planned, not booked yet), then key-value rows: when, where (with an “Open in Maps” link), confirmation (with Copy), link (site name plus truncated URL), files, details and book-by date. Buttons: Delete (ghost, with Undo toast), Edit, and Show tickets (primary).

**Show tickets.** Full-screen viewer with a white card in both light and dark themes so QR codes scan well. It shows the type and date, the title, the confirmation number in large type with a Copy button, every image full width, an “Open \<file>” button per PDF, and the address.

**Reminders from trips**

- A planned reservation with a Book by date creates a task “Book: \<title>” on that date. Completing it opens the reservation form with Booked selected; saving as Booked closes the task. Saving it as Planned again keeps or updates it.
- A flight creates “Check in online: \<title>” the day before departure. Moving the flight moves the task.
- Trip tasks appear in the Agenda tagged “\<Trip> · Trip”. Their detail dialog has an “Open trip” button.

**Trip dialog** (new or edit): Trip name (required), Destination, Starts and Ends (ending before the start is rejected with a toast), “Who is going” as a checkbox list of people, Notes. Edit also has “Delete trip” (removes its reservations and tasks, toast with Undo).

## Contacts

Contacts are shared by every person and car: a pediatrician can serve two children, a garage can serve both cars.

- Header: muted line “Shared by everyone and every car”, title “Contacts”, primary “Add contact”.
- Three groups with headings and counts: Health, Cars, Other. Each is a grid of tiles.
- Contact tile: name in semibold, role in muted text, the phone number in 17 px semibold, an optional note, and “Used for: Honda Civic · Safety inspection, Toyota Yaris · Safety inspection” listing the routines that name this contact as preferred.
- Actions: Call (primary, a tel link) and Copy number (toast “Copied 555-0142”).
- Add contact dialog: Name (required), Role, Phone (required), Group (Health, Cars, Other), Notes.
- Where contacts are offered: preferred contact on routines, the provider on appointments, the provider on health documents. Health routines offer Health and Other contacts; car routines offer Car and Other contacts.

## Shared interaction patterns

**Dialogs**

- Bottom sheet on mobile, centered on screens from 700 px wide. Width 560 px, or 720 px for the wide ones (routine form and detail, reservation form).
- Header: a muted eyebrow line, the title (18 px semibold) and a 44 px close button. Soft scrim at 35 percent. Esc or a scrim click closes.
- Focus moves into the dialog on open and returns to the opener on close. The page behind does not scroll.
- Action bar at the bottom right: destructive action as a ghost button on the left, then Cancel (ghost), then the primary button. Wraps on narrow screens.
- One dialog at a time. Actions that lead somewhere else (for example “Open trip”) close the dialog first.

**Full-screen viewers.** Used for documents, IDs and tickets. A sticky top bar (Close, name, Download) over a scrolling page, Esc to close. Looks the same on all screen sizes.

**Toasts.** One at a time, bottom center (above the tab bar on mobile), inverted colors, about 5 seconds, announced politely to screen readers. Many carry an Undo action: deleting a task, archiving a document, deleting a reservation or trip, and every drag move in the Agenda. Logical validation problems also appear as toasts: duplicate plate, duplicate person name, trip or reservation end before start, no person or car chosen.

**Forms**

- Labels above fields in muted 13 px, fields on the tint fill, 42 px high, accent focus outline.
- Native date, time and date-time inputs. Quick-pick chips for dates where useful.
- Optional fields say “(optional)” in the label. Required ones use the browser’s required validation.
- Fieldsets (tinted boxes with a small legend) group related options: Assign to, Schedule, Who is going, renewal reminder.
- Changing a dependent control refreshes the related one in place (For refreshes Routine; ID type refreshes More details; reservation type refreshes labels).

**Empty states.** Short muted lines on a tint block that tell the user what to do next, for example “No routines yet. Add one, or assign an existing routine.” or “Nothing here yet. Add a flight, hotel, car or activity and the timeline builds itself.”

**Archive instead of delete.** Documents are archived, not deleted. Archived items collect under “Archive (n)” with Show/Hide and Restore. Tasks, reservations and trips can be deleted with Undo.

**Writing style.** Sentence case everywhere. Plain words, no emoji. Dates as “Nov 8, 2026” (year omitted when it is the current year in compact labels). Times in 24-hour format. Relative labels: Today, Tomorrow, weekday names within a week, “3 days overdue”.

**Status vocabulary.** The same dot-and-word status and the same green, amber, red, blue and grey meanings are used for routines, documents, trips and passports.

**Hover and focus.** Tiles and rows darken slightly on hover. Every control shows a 2 px accent focus ring with a 2 px offset when focused by keyboard.

## Responsive behavior and accessibility

**Responsive**

- One breakpoint at 820 px. Above it: sidebar plus content. Below it: the sidebar disappears and a bottom tab bar appears; the main column loses its side padding to 18 px and gains 120 px of bottom space.
- All grids (Home tiles, routine cards, ID cards, contacts, trip tiles) reflow with auto-fill and a minimum column width, so they become one or two columns on phones.
- Forms with two columns (the `fields` pairs) collapse to one column below 560 px. The Person or Car chooser collapses to one column on mobile.
- On phones, subject pages show the scrolling chip switcher and the section segmented control at the top.
- Dialogs become bottom sheets on phones and keep safe-area padding. The tab bar and sticky bars respect iPhone safe-area insets.
- Coarse-pointer devices get 44 px buttons (40 px for small ones). The drag handle and flip card work with touch; the handle blocks page scroll only while pressed.

**Accessibility**

- Everything interactive is a real button or link. Icon-only controls have an accessible name (“Move: \<task>. Drag, or use the up and down arrow keys.”, “Open link for \<title>”, “Show tickets for \<title>”, “Archive \<name>”).
- Toggle-like controls (chip groups, segmented controls) expose their pressed or selected state. Dialogs have a dialog role and are modal. Toasts are polite status messages.
- The Home tile indicators have no visible text, so each carries a tooltip and a screen-reader-only phrase such as “2 reminders” or “1 overdue item”.
- Color is never the only signal: every status has a word or an icon and a count.
- Text and status colors meet AA contrast on their backgrounds in both themes. Muted text is at least 4.5 to 1.
- Keyboard: Tab order follows visual order; Enter or Space flips an ID card; Up and Down on the grip handle moves a task; Esc closes dialogs and viewers.
- Respect reduced motion: the flip becomes instant.
- Light and dark follow the operating system setting.

## Demo data and acceptance checks

Seed the app with this data so every screen has something to show. Dates are relative to today.

**Seed data**

| Area | Data |
| --- | --- |
| People | Alex (born 1984), Maya (1985), Noa (2016), Ben (2019) |
| Cars | Honda Civic, plate KDR 4821; Toyota Yaris, plate LMN 7305 |
| Contacts | Garage, insurance agent and roadside help (Cars); family doctor, pediatrician, dentist, orthopedist, optician, lab, pharmacy (Health) |
| Car routines | Insurance, safety inspection, registration and service on both cars (shared routines); one service already booked; Civic inspection unbooked and overdue to schedule |
| Health routines | Annual checkup (Alex, Noa, Ben), dental cleaning (Maya, already booked, and Ben), labs and an orthopedist follow-up (Alex, booked), eye exam, vaccinations, medication refills (Noa’s inhaler runs out in 6 days with no refills left) |
| No-schedule routines | “Emergency kit” on both cars; “School medical forms” on Noa and Ben |
| Identity | A passport for each person (Ben’s already expired, Alex’s expiring in about 7 months), Alex’s driver license, Maya’s city ID; each with a renewal routine. Alex’s license and Maya’s ID have sample front and back images; Alex’s passport has only a front |
| Treatment history | Alex’s “Knee injury” episode with a referral, an MRI report and an orthopedist summary; lab results; prescriptions |
| Trips | “Lisbon and Sintra” in about 3 weeks (8 days, 4 travelers): overnight flight out, hotel, dinner, rental car, an unbooked guesthouse with a book-by date, Pena Palace tickets, an unbooked AllTrails hike, return flight, with sample ticket images. A past “Boston long weekend” |
| General tasks | Pay property tax (overdue), call the plumber (today), renew gym membership, book flights for the holiday |

**Acceptance checks**

- [ ] Home shows six person and car tiles, a General tile and a Lisbon trip tile, all the same height, with icon-and-count indicators and no text beside them.
- [ ] Tiles are ordered by urgency; tapping one opens the right page.
- [ ] Agenda has four sections, always visible; no stats bar; one Add task button.
- [ ] Dragging a task between sections changes its date by the neighbor rule and offers Undo; the Up and Down keys do the same.
- [ ] Add task dialog: Routine is disabled for General and refreshes when For changes.
- [ ] Completing “Book dental cleaning” asks for date, time, provider and prep notes, then adds the appointment and a prep reminder.
- [ ] Completing a renewal step asks for the new date and plans the next cycle.
- [ ] Creating a routine with no schedule for two people works; adding a date later generates steps.
- [ ] A person’s Health and Identity pages never show each other’s documents.
- [ ] Adding an ID with an expiry date and the reminder box ticked creates a renewal routine.
- [ ] Clicking an ID card flips it, in the grid and in the full-screen viewer, and the flip survives navigating around.
- [ ] ID numbers are masked in lists and shown in full only in the viewer.
- [ ] The trip timeline shows the overnight flight’s arrival on the second day, hotel check-in and check-out, and “Staying at” lines in between.
- [ ] Show tickets shows a white card with the confirmation number and images in dark mode too.
- [ ] Traveler chips show the Lisbon passport warnings for Alex (amber) and Ben (red).
- [ ] Below 820 px the sidebar becomes a five-tab bar and dialogs become bottom sheets.
- [ ] Light and dark themes both render with the specified tokens.
