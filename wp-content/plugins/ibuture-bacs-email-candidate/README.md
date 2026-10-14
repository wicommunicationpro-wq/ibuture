# IBUTURE BACS Email Candidate

This extension remains opt-in and does not change WooCommerce payment settings.

## Enabling the two emails

1. Activate the extension from **WordPress Admin → Plugins** only after approval.
2. Open **WooCommerce → Settings → Emails**.
3. Open **IBUTURE — Instructions de virement** and enable that email.

The instructions email setting defaults to `no`. The shortened confirmation uses
the existing WooCommerce customer on-hold email and its existing enabled setting.
The BACS payment method must also be enabled and have bank details configured in
WooCommerce. No setting is changed by installing this extension.

## Delivery and language behavior

The send lock and order metadata prevent concurrent/repeated sends in normal
operation. They cannot guarantee exactly-once delivery: a mail provider may
accept a message before the process stops or the order marker can be saved. A
retry after that interruption can therefore send a duplicate.

Customer emails use WooCommerce's locale setup, which switches to the site's
locale. The strings use this extension's text domain so translation catalogs can
translate them in that locale. This code does not independently select a
language per order; that requires a multilingual integration that switches the
locale for the order.
