# Citizen app update — 1 October 2026

- Secondary screens have a Back control and a separate Home icon. Back returns to the previous in-app section; the complaint wizard goes back one step. Home resets section history.
- Submission shows a selectable reference number. The server creates a random reference, checks it against existing records, persists it with the complaint, and includes it in the WhatsApp acknowledgement log.
- External messaging is WhatsApp-only. SMS fallback and device push registration are disabled. In-app notifications remain available.
- An administrator selects **Request closure · WhatsApp OTP** after adding after-work evidence and a resolution note. This creates the challenge automatically and leaves the complaint at **Resolution Proposed**. Only resident verification can close it; expired, locked and reused codes are rejected.
- In the current test workspace, the resident selects **Preview WhatsApp OTP (test only)** to view the code. Codes are omitted from admin responses, communication logs and workspace projections. These are simulated challenges, not production phone authentication.
- Three clearly labeled fictional ads, three fictional places and sample city history are added once, with a version marker and optimistic concurrency. Existing city information and edited or archived samples are preserved. Administrators can edit the entries through Classifieds and City & places.

## WhatsApp setup still required

The user confirmed that no provider is configured. No real WhatsApp message is sent. A verified Business sender, approved authentication/utility templates, provider credentials, verified resident phone identities, delivery callbacks and a reliable dispatcher are required before real delivery can be enabled. Pending test events are logs, not a live delivery queue, and must not be bulk-sent when a provider is added. The test-code preview must be removed from production authentication.

## Verification

20 domain and permission tests passed. The local API flow passed complaint submission through admin resolution proposal, incorrect OTP, resident verification, replay rejection, dispute and optimistic-concurrency handling. Mobile lint and typechecking passed. Web/native export and browser inspection are performed separately before publication; native store signing and device release testing are not included.
