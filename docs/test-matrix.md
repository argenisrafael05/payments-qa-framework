# Case matrix

The cases the framework runs against PayRef. Each one is a JSON in `framework/cases/base/`, and it makes one test per integration and per variation. Results don't go here: each run keeps its own in its report.

What tests the framework itself is in [the framework tests](framework-tests.md).

## F-01 The happy payment

Each reference type gets paid end to end.

| Case   | What it checks                   | Expects | Where it runs | Stories      |
| ------ | -------------------------------- | ------- | ------------- | ------------ |
| F01-01 | A reference of each type is paid | OK      | All three     | US-01, US-08 |

## F-02 The reference doesn't apply

What can't be paid gets rejected with its code, and leaves nothing in the database.

| Case   | What it checks                                          | Expects | Where it runs | Stories             |
| ------ | ------------------------------------------------------- | ------- | ------------- | ------------------- |
| F02-01 | A code nobody created is not found, whatever its length | R-101   | All three     | US-02, US-08, US-09 |
| F02-02 | An expired reference is rejected                        | R-103   | All three     | US-02, US-08, US-09 |
| F02-03 | A cancelled reference is not paid                       | R-105   | All three     | US-02, US-08, US-09 |

## F-03 The amount isn't valid

An amount that isn't valid gets rejected, and never rounded.

| Case   | What it checks                                                                 | Expects | Where it runs | Stories      |
| ------ | ------------------------------------------------------------------------------ | ------- | ------------- | ------------ |
| F03-01 | A fixed reference only takes its exact amount                                  | R-104   | All three     | US-02, US-08 |
| F03-02 | An open reference accepts the limits of the payment method                     | OK      | All three     | US-02, US-08 |
| F03-03 | An open reference rejects an amount outside the limits of the payment method   | R-104   | All three     | US-02, US-08 |
| F03-04 | A zero or negative amount is rejected                                          | R-104   | All three     | US-02, US-08 |
| F03-05 | An amount with more decimals than its region allows is rejected, never rounded | R-104   | All three     | US-02, US-08 |

## F-05 Repeated payments

A single reference takes no other payment, and a recurring one does, with another sequence.

| Case   | What it checks                                         | Expects | Where it runs | Stories      |
| ------ | ------------------------------------------------------ | ------- | ------------- | ------------ |
| F05-01 | A paid single reference takes no other payment         | R-102   | All three     | US-02, US-09 |
| F05-02 | A repeated notice on a recurring reference is rejected | R-106   | All three     | US-02, US-09 |
| F05-03 | A recurring reference takes a new payment              | OK      | All three     | US-02, US-09 |

## F-06 The expiry

The date and time boundaries of each region, and what the inquiry reports.

| Case   | What it checks                                                                  | Expects | Where it runs | Stories      |
| ------ | ------------------------------------------------------------------------------- | ------- | ------------- | ------------ |
| F06-01 | A reference is paid until the last second of its day, in the time of its region | OK      | All three     | US-02, US-09 |
| F06-02 | A reference expires at midnight of its region                                   | R-103   | All three     | US-02, US-09 |
| F06-03 | The expiry counts the day of the region, not the one of UTC                     | OK      | All three     | US-02, US-09 |
| F06-04 | The inquiry reports an expired reference as expired                             | OK      | Supermarket   | US-08        |

## F-07 The reversal window

What happens to the payment while its window runs, and when it closes.

| Case   | What it checks                                                                           | Expects | Where it runs | Stories      |
| ------ | ---------------------------------------------------------------------------------------- | ------- | ------------- | ------------ |
| F07-01 | The notice confirms the payment one second before the window closes                      | OK      | Bank          | US-10        |
| F07-02 | The reversal one second before the window closes leaves the reference active             | OK      | Bank          | US-10        |
| F07-03 | The reversal at the end of the window gets R-107, and the payment is confirmed           | R-107   | Bank          | US-10        |
| F07-04 | Without a notice or a reversal, the payment is confirmed on its own when the window ends | OK      | Bank          | US-10        |
| F07-05 | Another request while the window runs gets R-108                                         | R-108   | Bank          | US-10        |
| F07-06 | The merchant cannot cancel the reference while the window runs                           | R-108   | Bank          | US-10, US-07 |
| F07-07 | The payment is confirmed even if the reference expires while the window runs             | OK      | Bank          | US-10        |
| F07-08 | Another notice of a confirmed payment of a single reference gets R-102                   | R-102   | Bank          | US-10        |
| F07-09 | Another notice of a confirmed payment of a recurring reference is a repeated notice      | R-106   | Bank          | US-10        |
| F07-10 | A reversal after the window closed gets R-107                                            | R-107   | Bank          | US-10        |
| F07-11 | The notice of a reversed payment gets R-107                                              | R-107   | Bank          | US-10        |
| F07-12 | A reversed payment leaves the reference payable again                                    | OK      | Bank          | US-10        |

## F-08 The webhook

What can go wrong with a webhook: late, with another amount, without a signature or with a bad one.

| Case   | What it checks                                                             | Expects | Where it runs | Stories      |
| ------ | -------------------------------------------------------------------------- | ------- | ------------- | ------------ |
| F08-01 | A late webhook for a reference that expired after its resource is rejected | R-103   | Wallet        | US-11, US-12 |
| F08-02 | A late webhook for a reference cancelled after its resource is rejected    | R-105   | Wallet        | US-11, US-12 |
| F08-03 | A webhook with a different amount than its resource is rejected            | R-104   | Wallet        | US-11, US-12 |
| F08-04 | A webhook without a signature gets 401                                     | 401     | Wallet        | US-09, US-11 |
| F08-05 | A webhook with a signature that does not match gets 401                    | 401     | Wallet        | US-09, US-11 |
| F08-06 | A webhook for a resource nobody created is not applied                     | R-101   | Wallet        | US-11        |

## F-09 The resource

When the same QR comes back, and when a new one does.

| Case   | What it checks                                                          | Expects | Where it runs | Stories |
| ------ | ----------------------------------------------------------------------- | ------- | ------------- | ------- |
| F09-01 | Asking again for the resource of an unpaid reference gives the same one | OK      | Wallet        | US-11   |
| F09-02 | Asking again with another amount gives a new resource                   | OK      | Wallet        | US-11   |

## F-10 The merchant

Creating, viewing and cancelling a reference, and what's off limits for another merchant.

| Case   | What it checks                                                                          | Expects | Where it runs | Stories      |
| ------ | --------------------------------------------------------------------------------------- | ------- | ------------- | ------------ |
| F10-01 | The merchant sees the state of its reference                                            | OK      | All three     | US-07        |
| F10-02 | The merchant sees an expired reference as expired                                       | OK      | All three     | US-07        |
| F10-03 | The merchant cancels an active reference                                                | OK      | All three     | US-07        |
| F10-04 | A paid single reference is not cancelled                                                | R-102   | All three     | US-07        |
| F10-05 | A cancelled reference is not cancelled again                                            | R-105   | All three     | US-07        |
| F10-06 | An expired reference is not cancelled                                                   | R-103   | All three     | US-07        |
| F10-07 | An amount that is not valid does not create a fixed reference                           | 400     | All three     | US-07        |
| F10-08 | A fixed reference without its amount is not created                                     | 400     | All three     | US-07        |
| F10-09 | An open reference with an amount is not created                                         | 400     | All three     | US-07        |
| F10-10 | A reference that expired yesterday is not created                                       | 400     | All three     | US-07        |
| F10-11 | A reference that expires today is created                                               | OK      | All three     | US-07        |
| F10-12 | A merchant does not see the reference of another merchant                               | R-101   | All three     | US-07        |
| F10-13 | A merchant does not cancel the reference of another merchant                            | R-101   | All three     | US-07        |
| F10-14 | Another merchant cannot ask for the payment resource of a reference that is not its own | R-101   | Wallet        | US-07, US-11 |

## F-11 Access and errors

No credentials, no entry, and no response shows internal details.

| Case   | What it checks                                                      | Expects | Where it runs        | Stories      |
| ------ | ------------------------------------------------------------------- | ------- | -------------------- | ------------ |
| F11-01 | A request without a token is not served                             | 401     | All three            | US-09        |
| F11-02 | A made-up token gets 401 before PayRef looks for the reference      | 401     | All three            | US-09        |
| F11-03 | A wrong key gets no token                                           | 401     | All three            | US-09        |
| F11-04 | A merchant cannot send a payment                                    | 403     | Supermarket and Bank | US-09        |
| F11-05 | A malformed request gets 400 without internal details               | 400     | All three            | US-02, US-09 |
| F11-06 | A payment method without a reversal window cannot reverse a payment | 403     | Supermarket          | US-08, US-09 |
