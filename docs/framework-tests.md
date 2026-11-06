# The framework's tests

The cases test PayRef. These test the framework: if PayRef gets something wrong, does the framework notice? They run with Vitest, with no PayRef and no Docker, and all 166 take under a second. The cases are in [the case matrix](test-matrix.md).

## What's checked

| Piece              | What's checked                                                                                                                 | Tests |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| The judge          | The exact code, another rejection, an unclassified response, a leak that brings the expected code, and a 500 against a timeout | 15    |
| The case result    | The table of the four results, and that a Passed with incomplete evidence isn't approved                                       | 9     |
| The runner         | Where a case stops, that the database check always runs, and that a wrong OK doesn't count as an expected payment              | 10    |
| The database check | Movements that are extra, missing, in another state, with another amount or another date                                       | 13    |
| The extra checks   | The state the reference ends up in, and when it's the same resource or a new one                                               | 7     |
| The evidence       | That it keeps what really happened, preserves the failure and hides the credentials                                            | 18    |
| The catalog        | Typos at load time, the lists that multiply and what changes by region                                                         | 34    |
| The crossing       | Which case runs on each integration, and two test integrations made only of config, with a window and without one              | 8     |
| The flows          | The flow of each integration, the ways of calling the objective and that the credential goes first                             | 20    |
| The wallet         | The signature, its codes, the two notice sources and the step that observes                                                    | 11    |
| The time           | The time of each region, and the expired reference that gets created the day before                                            | 5     |
| The quick check    | That PayRef answers with its region and its version, and that it says what's missing                                           | 6     |
| The report         | The totals, each test with its reason, and that a body PayRef answered never runs in the page                                  | 8     |
| The matrix         | That each case has its row, with the same stories as its tags                                                                  | 2     |

The judge and the evidence reach 80% of lines and branches, and `npm run verify` fails if they drop.

## The traps

A test that defends against a trap proves it: the naive version passes falsely, and the framework's doesn't.

- A judge that only looks at the 200 approves a rejection that came with a 200.
- A check that there's no movement, right after asking the wallet for the webhook, passes even if the webhook never arrives.

## What gets broken on purpose

A test that never fails proves nothing. So 55 pieces of the framework get broken, one at a time, and each one has to fail its test. Here are some:

| What gets broken                                               | The test that fails                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The judge stops checking for leaks                             | The one with a leak that brings the expected code                         |
| The judge takes a 500 as Inconclusive                          | The one with a 500 against a timeout                                      |
| The database check doesn't run after a failure                 | The one with a database that doesn't match after a failure                |
| A payment the API accepted by mistake counts as expected       | The one with the wrong OK, which doesn't count for the database           |
| The database check compares the amount with two decimals       | The one with an amount the database rounded                               |
| The masking lets the `Authorization` through                   | The masking one                                                           |
| The catalog lets a misspelled field through                    | The one with the typo at load time                                        |
| The crossing runs a case that doesn't apply to its integration | The one with the case that doesn't run on an integration without its step |
| The window's time ignores its integration's window             | The one with the test integration and its 5-minute window                 |
| The step that observes doesn't wait for the webhook            | The one with the webhook that shows up on the third ask                   |
| The framework's webhook travels without spaces                 | The one with the signature over the exact bytes                           |
| Without a token, the body arrives whole                        | The one with the credential that goes first                               |
| A test without its file counts as Passed                       | The one with each test of the selection and its result                    |
| The report lets what PayRef answered run in the page           | The one with the body that never runs in the page                         |

The cases get broken too: what they expect gets changed in their JSON, and they have to fail saying what they expected and what they got. And against the version of PayRef with bugs, each bug fails the case it belongs to.
