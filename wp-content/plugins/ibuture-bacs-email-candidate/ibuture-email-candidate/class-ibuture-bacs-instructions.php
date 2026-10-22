<?php
/**
 * IBUTURE — e-mail distinct des instructions de virement.
 * L'envoi reste soumis au réglage WooCommerce de cet e-mail.
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WC_Email' ) ) {
    return;
}

class IBUTURE_Email_BACS_Instructions extends WC_Email {

    const SENT_META = '_ibuture_bacs_instructions_email_sent';
    const LOCK_TTL  = 1800;
    const LEGACY_LOCK_TTL = 600;

    public function init_form_fields() {
        $this->form_fields = array(
            'enabled' => array(
                'type'    => 'checkbox',
                'label'   => __( 'Diese E-Mail aktivieren', 'ibuture-bacs-email-candidate' ),
                'default' => 'no',
            ),
            'subject' => array(
                'type'    => 'text',
                'label'   => __( 'Betreff', 'ibuture-bacs-email-candidate' ),
                'default' => __( 'Zahlungsanweisungen für Überweisung – Bestellung #{order_number}', 'ibuture-bacs-email-candidate' ),
            ),
            'heading' => array(
                'type'    => 'text',
                'label'   => __( 'E-Mail-Überschrift', 'ibuture-bacs-email-candidate' ),
                'default' => __( 'Zahlungsanweisungen für Ihre Banküberweisung', 'ibuture-bacs-email-candidate' ),
            ),
            'email_type' => array(
                'type'    => 'select',
                'label'   => __( 'E-Mail-Format', 'ibuture-bacs-email-candidate' ),
                'default' => 'html',
                'options' => array(
                    'html'  => __( 'HTML', 'ibuture-bacs-email-candidate' ),
                    'plain' => __( 'Texte brut', 'ibuture-bacs-email-candidate' ),
                ),
            ),
        );
    }

    public function __construct() {
        $this->id             = 'ibuture_bacs_instructions';
        $this->title          = __( 'IBUTURE – Überweisungsanweisungen', 'ibuture-bacs-email-candidate' );
        $this->description    = __( 'Separate E-Mail mit den BACS-Überweisungsanweisungen.', 'ibuture-bacs-email-candidate' );
        $this->customer_email = true;
        $this->heading        = __( 'Zahlungsanweisungen für Ihre Banküberweisung', 'ibuture-bacs-email-candidate' );
        $this->subject        = __( 'Zahlungsanweisungen für Überweisung – Bestellung #{order_number}', 'ibuture-bacs-email-candidate' );
        $this->email_type     = 'html';

        parent::__construct();

        /*
         * Déclenchement uniquement lors du passage à on-hold.
         * trigger() revérifie le moyen de paiement et l'anti-doublon.
         */
        add_action(
            'woocommerce_order_status_on-hold',
            array( $this, 'trigger' ),
            20,
            2
        );
    }

    private function get_lock_expiration( $lock_value ) {
        if ( is_numeric( $lock_value ) && preg_match( '/^\d+$/', (string) $lock_value ) ) {
            return (int) $lock_value + self::LEGACY_LOCK_TTL;
        }

        if ( ! is_string( $lock_value ) || 1 !== substr_count( $lock_value, '|' ) ) {
            return null;
        }

        $parts = explode( '|', $lock_value, 2 );
        return ctype_digit( $parts[1] ) ? (int) $parts[1] : null;
    }

    private function delete_lock_if_unchanged( $lock_key, $lock_value ) {
        global $wpdb;

        // Match the stored value atomically so an expired owner cannot delete a replacement lock.
        $deleted = $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name = %s AND BINARY option_value = BINARY %s",
                $lock_key,
                (string) $lock_value
            )
        );

        wp_cache_delete( $lock_key, 'options' );

        if ( 1 === $deleted ) {
            return true;
        }

        return false;
    }

    private function acquire_send_lock( $lock_key ) {
        $lock_value = wp_generate_uuid4() . '|' . ( time() + self::LOCK_TTL );
        $current    = get_option( $lock_key, false );

        if ( false === $current ) {
            return add_option( $lock_key, $lock_value, '', false ) ? $lock_value : false;
        }

        $expires_at = $this->get_lock_expiration( $current );
        if ( null === $expires_at || $expires_at > time() ) {
            return false;
        }

        if ( ! $this->delete_lock_if_unchanged( $lock_key, $current ) ) {
            return false;
        }

        return add_option( $lock_key, $lock_value, '', false ) ? $lock_value : false;
    }

    private function release_send_lock( $lock_key, $lock_value ) {
        $this->delete_lock_if_unchanged( $lock_key, $lock_value );
    }

    public function trigger( $order_id, $order = false ) {
        if ( ! $this->is_enabled() ) {
            return;
        }

        if ( ! $order instanceof WC_Order ) {
            $order = wc_get_order( $order_id );
        }

        if ( ! $order instanceof WC_Order ) {
            return;
        }

        if ( 'bacs' !== $order->get_payment_method() ) {
            return;
        }

        if ( 'on-hold' !== $order->get_status() ) {
            return;
        }

        if ( $order->get_meta( self::SENT_META, true ) ) {
            return;
        }

        $recipient = $order->get_billing_email();

        if ( ! $recipient || ! is_email( $recipient ) ) {
            return;
        }

        $accounts_check = get_option( "woocommerce_bacs_accounts", array() );
        $has_transfer_details = false;
        if ( is_array( $accounts_check ) ) {
            foreach ( $accounts_check as $account_check ) {
                if ( ! is_array( $account_check ) ) { continue; }
                if ( ! empty( $account_check["account_number"] ) || ! empty( $account_check["iban"] ) ) {
                    $has_transfer_details = true;
                    break;
                }
            }
        }
        if ( ! $has_transfer_details ) { return; }
        $this->object = $order;
        $this->recipient = $recipient;
        $this->placeholders = array(
            '{order_date}'   => wc_format_datetime( $order->get_date_created() ),
            '{order_number}' => $order->get_order_number(),
        );

        $lock_key   = '_ibuture_bacs_email_lock_' . $order->get_id();
        $lock_value = $this->acquire_send_lock( $lock_key );
        if ( false === $lock_value ) {
            return;
        }

        $stage        = 'locale setup';
        $locale_setup = false;

        try {
            try {
                $locale_setup = function_exists( 'switch_to_locale' )
                    && switch_to_locale( 'de_DE' );

                $stage = 'order recheck';
                $locked_order = wc_get_order( $order->get_id() );
                if ( ! $locked_order instanceof WC_Order
                    || 'bacs' !== $locked_order->get_payment_method()
                    || 'on-hold' !== $locked_order->get_status()
                    || $locked_order->get_meta( self::SENT_META, true )
                ) {
                    return;
                }

                $order     = $locked_order;
                $recipient = $order->get_billing_email();
                if ( ! $recipient || ! is_email( $recipient ) ) {
                    return;
                }

                $this->object    = $order;
                $this->recipient = $recipient;
                $this->placeholders = array(
                    '{order_date}'   => wc_format_datetime( $order->get_date_created() ),
                    '{order_number}' => $order->get_order_number(),
                );

                $stage       = 'email content preparation';
                $subject     = $this->get_subject();
                $content     = $this->get_content();
                $headers     = $this->get_headers();
                $attachments = $this->get_attachments();

                $stage = 'send';
                $sent = $this->send(
                    $recipient,
                    $subject,
                    $content,
                    $headers,
                    $attachments
                );

                if ( ! $sent ) {
                    wc_get_logger()->error(
                        'The BACS instructions email could not be sent.',
                        array( 'source' => 'ibuture-bacs-instructions' )
                    );
                    return;
                }

                $stage = 'sent marker persistence';
                $order->update_meta_data( self::SENT_META, gmdate( 'c' ) );
                if ( ! $order->save() ) {
                    wc_get_logger()->error(
                        'The BACS instructions email was sent, but its sent status could not be saved.',
                        array( 'source' => 'ibuture-bacs-instructions' )
                    );
                }
            } catch ( Throwable $error ) {
                wc_get_logger()->error(
                    sprintf(
                        'The BACS instructions email failed during %s (%s).',
                        $stage,
                        get_class( $error )
                    ),
                    array(
                        'source'     => 'ibuture-bacs-instructions',
                        'stage'      => $stage,
                        'error_type' => get_class( $error ),
                    )
                );
            }
        } finally {
            try {
                if ( $locale_setup ) {
                    restore_previous_locale();
                }
            } finally {
                $this->release_send_lock( $lock_key, $lock_value );
            }
        }
    }

    public function get_content_html() {
        if ( ! $this->object instanceof WC_Order ) {
            return '';
        }

        $order = $this->object;
        $settings = get_option( 'woocommerce_bacs_settings', array() );
        $accounts = get_option( 'woocommerce_bacs_accounts', array() );

        ob_start();

        do_action(
            'woocommerce_email_header',
            $this->get_heading(),
            $this
        );
        ?>
        <p>
            <?php
            printf(
                esc_html__( 'Guten Tag %s,', 'ibuture-bacs-email-candidate' ),
                esc_html( $order->get_billing_first_name() ?: '' )
            );
            ?>
        </p>

        <p>
            <?php
            esc_html_e(
                'Bitte überweisen Sie den folgenden Betrag unter Verwendung der nachstehenden Angaben.',
                'ibuture-bacs-email-candidate'
            );
            ?>
        </p>

        <p>
            <strong>
                <?php esc_html_e( 'Bestellnummer:', 'ibuture-bacs-email-candidate' ); ?>
                <?php echo esc_html( $order->get_order_number() ); ?>
            </strong>
        </p>

        <p>
            <strong><?php esc_html_e( 'Zu überweisender Betrag:', 'ibuture-bacs-email-candidate' ); ?></strong>
            <?php echo wp_kses_post( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ); ?>
        </p>

        <p>
            <strong>
                <?php esc_html_e( 'Verwendungszweck:', 'ibuture-bacs-email-candidate' ); ?>
                <?php echo esc_html( $order->get_order_number() ); ?>
            </strong>
        </p>

        <?php if ( ! empty( $settings['instructions'] ) ) : ?>
            <p><?php echo wp_kses_post( wpautop( $settings['instructions'] ) ); ?></p>
        <?php endif; ?>

        <?php if ( is_array( $accounts ) && $accounts ) : ?>
            <h2><?php esc_html_e( 'Bankverbindung', 'ibuture-bacs-email-candidate' ); ?></h2>

            <?php foreach ( $accounts as $account ) : ?>
                <?php if ( ! is_array( $account ) ) { continue; } ?>
                <ul>
                    <?php
                    $labels = array(
                        'account_name'   => __( 'Kontoinhaber', 'ibuture-bacs-email-candidate' ),
                        'bank_name'      => __( 'Bank', 'ibuture-bacs-email-candidate' ),
                        'account_number' => __( 'Kontonummer', 'ibuture-bacs-email-candidate' ),
                        'sort_code'      => __( 'Bankleitzahl', 'ibuture-bacs-email-candidate' ),
                        'iban'           => __( 'IBAN', 'ibuture-bacs-email-candidate' ),
                        'bic'            => __( 'BIC / SWIFT', 'ibuture-bacs-email-candidate' ),
                    );

                    foreach ( $labels as $key => $label ) :
                        if ( empty( $account[ $key ] ) ) {
                            continue;
                        }
                    ?>
                        <li>
                            <strong><?php echo esc_html( $label ); ?> :</strong>
                            <?php echo esc_html( $account[ $key ] ); ?>
                        </li>
                    <?php endforeach; ?>
                </ul>
            <?php endforeach; ?>
        <?php endif; ?>

        <p>
            <?php
            esc_html_e(
                'Ihre Bestellung wird nach Eingang und Bestätigung der Zahlung bearbeitet.',
                'ibuture-bacs-email-candidate'
            );
            ?>
        </p>

        <?php
        $order_number = $order->get_order_number();
        $mailto_body = rawurlencode(
            sprintf(
                'Guten Tag, ich habe die Zahlung für die Bestellung Nr. %1$s bereits vorgenommen. Verwendungszweck der Überweisung: %1$s.',
                $order_number
            )
        );
        $mailto_url = 'mailto:official@lbuture.com?subject='
            . rawurlencode( 'Zahlung bereits erfolgt' )
            . '&body=' . $mailto_body;
        ?>
        <h2><?php esc_html_e( 'Wichtiger Hinweis', 'ibuture-bacs-email-candidate' ); ?></h2>
        <p>
            <?php
            printf(
                esc_html__(
                    'Ihre Bestellung wird bearbeitet, sobald Ihre Zahlung eingegangen ist. Bitte geben Sie die Bestellnummer %1$s als Verwendungszweck Ihrer Überweisung an, damit wir Ihre Zahlung eindeutig zuordnen können.',
                    'ibuture-bacs-email-candidate'
                ),
                esc_html( $order_number )
            );
            ?>
        </p>
        <p>
            <?php
            esc_html_e(
                'Wenn Sie die Zahlung bereits vorgenommen haben, ',
                'ibuture-bacs-email-candidate'
            );
            ?><a href="<?php echo esc_attr( $mailto_url ); ?>"><?php esc_html_e( 'klicken Sie hier', 'ibuture-bacs-email-candidate' ); ?></a><?php
            esc_html_e(
                ', um uns darüber zu informieren.',
                'ibuture-bacs-email-candidate'
            );
            ?>
        </p>

        <h2><?php esc_html_e( 'Zusammenfassung Ihrer Bestellung', 'ibuture-bacs-email-candidate' ); ?></h2>
        <p>
            <strong><?php esc_html_e( 'Bestellnummer:', 'ibuture-bacs-email-candidate' ); ?></strong>
            <?php echo esc_html( $order_number ); ?>
        </p>
        <table>
            <thead>
                <tr>
                    <th><?php esc_html_e( 'Produkt', 'ibuture-bacs-email-candidate' ); ?></th>
                    <th><?php esc_html_e( 'Menge', 'ibuture-bacs-email-candidate' ); ?></th>
                    <th><?php esc_html_e( 'Gesamtpreis', 'ibuture-bacs-email-candidate' ); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ( $order->get_items() as $item ) : ?>
                    <tr>
                        <td><?php echo esc_html( $item->get_name() ); ?></td>
                        <td><?php echo esc_html( $item->get_quantity() ); ?></td>
                        <td><?php echo wp_kses_post( $order->get_formatted_line_subtotal( $item ) ); ?></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
            <tfoot>
                <tr>
                    <th colspan="2"><?php esc_html_e( 'Zwischensumme', 'ibuture-bacs-email-candidate' ); ?></th>
                    <td><?php echo wp_kses_post( $order->get_subtotal_to_display() ); ?></td>
                </tr>
                <tr>
                    <th colspan="2"><?php esc_html_e( 'Versandkosten', 'ibuture-bacs-email-candidate' ); ?></th>
                    <td><?php echo wp_kses_post( $order->get_shipping_to_display() ); ?></td>
                </tr>
                <?php if ( $order->get_discount_total() > 0 ) : ?>
                    <tr>
                        <th colspan="2"><?php esc_html_e( 'Rabatt', 'ibuture-bacs-email-candidate' ); ?></th>
                        <td><?php echo wp_kses_post( $order->get_discount_to_display() ); ?></td>
                    </tr>
                <?php endif; ?>
                <tr>
                    <th colspan="2"><?php esc_html_e( 'Gesamtsumme', 'ibuture-bacs-email-candidate' ); ?></th>
                    <td><?php echo wp_kses_post( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ); ?></td>
                </tr>
            </tfoot>
        </table>

        <?php
        do_action( 'woocommerce_email_footer', $this );

        return ob_get_clean();
    }

    public function get_content_plain() {
        if ( ! $this->object instanceof WC_Order ) {
            return '';
        }

        $order = $this->object;
        $settings = get_option( 'woocommerce_bacs_settings', array() );
        $accounts = get_option( 'woocommerce_bacs_accounts', array() );

        $single_line = static function ( $value ) {
            $value = is_scalar( $value ) ? (string) $value : '';
            return trim( preg_replace( '/[\r\n\t]+/', ' ', wp_strip_all_tags( $value ) ) );
        };

        $text  = sprintf(
            __( 'Guten Tag %s,', 'ibuture-bacs-email-candidate' ),
            $single_line( $order->get_billing_first_name() )
        ) . "\n\n";
        $text .= __( 'Zahlungsanweisungen für Ihre Banküberweisung', 'ibuture-bacs-email-candidate' ) . "\n";
        $text .= __( 'Bestellnummer:', 'ibuture-bacs-email-candidate' ) . ' ' . $order->get_order_number() . "\n";
        $text .= __( 'Zu überweisender Betrag:', 'ibuture-bacs-email-candidate' ) . ' ' . html_entity_decode( wp_strip_all_tags( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ), ENT_QUOTES, get_bloginfo( 'charset' ) ) . "\n";
        $text .= __( 'Verwendungszweck:', 'ibuture-bacs-email-candidate' ) . ' ' . $order->get_order_number() . "\n\n";

        if ( ! empty( $settings['instructions'] ) ) {
            $text .= $single_line( $settings['instructions'] ) . "\n\n";
        }

        if ( is_array( $accounts ) ) {
            foreach ( $accounts as $account ) {
                if ( ! is_array( $account ) ) {
                    continue;
                }

                foreach (
                    array(
                        'account_name'   => __( 'Kontoinhaber', 'ibuture-bacs-email-candidate' ),
                        'bank_name'      => __( 'Bank', 'ibuture-bacs-email-candidate' ),
                        'account_number' => __( 'Kontonummer', 'ibuture-bacs-email-candidate' ),
                        'sort_code'      => __( 'Bankleitzahl', 'ibuture-bacs-email-candidate' ),
                        'iban'           => __( 'IBAN', 'ibuture-bacs-email-candidate' ),
                        'bic'            => __( 'BIC / SWIFT', 'ibuture-bacs-email-candidate' ),
                    ) as $key => $label
                ) {
                    if ( ! empty( $account[ $key ] ) ) {
                        $text .= $label . ' : ' . $single_line( $account[ $key ] ) . "\n";
                    }
                }

                $text .= "\n";
            }
        }

        $text .= __( 'Ihre Bestellung wird nach Eingang und Bestätigung der Zahlung bearbeitet.', 'ibuture-bacs-email-candidate' ) . "\n";

        $order_number = $order->get_order_number();
        $text .= "\n" . __( 'Wichtiger Hinweis', 'ibuture-bacs-email-candidate' ) . "\n";
        $text .= sprintf(
            __(
                'Ihre Bestellung wird bearbeitet, sobald Ihre Zahlung eingegangen ist. Bitte geben Sie die Bestellnummer %1$s als Verwendungszweck Ihrer Überweisung an, damit wir Ihre Zahlung eindeutig zuordnen können.',
                'ibuture-bacs-email-candidate'
            ),
            $order_number
        ) . "\n\n";
        $text .= sprintf(
            __(
                'Wenn Sie die Zahlung bereits vorgenommen haben, klicken Sie hier, um uns darüber zu informieren: %s',
                'ibuture-bacs-email-candidate'
            ),
            'mailto:official@lbuture.com?subject='
                . rawurlencode( 'Zahlung bereits erfolgt' )
                . '&body='
                . rawurlencode(
                    sprintf(
                        'Guten Tag, ich habe die Zahlung für die Bestellung Nr. %1$s bereits vorgenommen. Verwendungszweck der Überweisung: %1$s.',
                        $order_number
                    )
                )
        ) . "\n\n";

        $plain_text = static function ( $value ) {
            return html_entity_decode(
                wp_strip_all_tags( $value ),
                ENT_QUOTES,
                get_bloginfo( 'charset' )
            );
        };
        $text .= __( 'Zusammenfassung Ihrer Bestellung', 'ibuture-bacs-email-candidate' ) . "\n";
        $text .= __( 'Bestellnummer:', 'ibuture-bacs-email-candidate' ) . ' ' . $order_number . "\n\n";
        foreach ( $order->get_items() as $item ) {
            $text .= __( 'Produkt:', 'ibuture-bacs-email-candidate' ) . ' ' . $single_line( $item->get_name() ) . "\n";
            $text .= __( 'Menge:', 'ibuture-bacs-email-candidate' ) . ' ' . $single_line( $item->get_quantity() ) . "\n";
            $text .= __( 'Gesamtpreis:', 'ibuture-bacs-email-candidate' ) . ' ' . $plain_text( $order->get_formatted_line_subtotal( $item ) ) . "\n\n";
        }
        $text .= __( 'Zwischensumme:', 'ibuture-bacs-email-candidate' ) . ' ' . $plain_text( $order->get_subtotal_to_display() ) . "\n";
        $text .= __( 'Versandkosten:', 'ibuture-bacs-email-candidate' ) . ' ' . $plain_text( $order->get_shipping_to_display() ) . "\n";
        if ( $order->get_discount_total() > 0 ) {
            $text .= __( 'Rabatt:', 'ibuture-bacs-email-candidate' ) . ' ' . $plain_text( $order->get_discount_to_display() ) . "\n";
        }
        $text .= __( 'Gesamtsumme:', 'ibuture-bacs-email-candidate' ) . ' ' . $plain_text( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ) . "\n";

        return $text;
    }
}
