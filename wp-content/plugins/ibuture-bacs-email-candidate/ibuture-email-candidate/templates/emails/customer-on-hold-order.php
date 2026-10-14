<?php
defined( 'ABSPATH' ) || exit;

$email_heading = __( 'Wir haben Ihre Bestellung erhalten', 'ibuture-bacs-email-candidate' );
do_action( 'woocommerce_email_header', $email_heading, $email );

$customer_name = trim( (string) $order->get_billing_first_name() . ' ' . (string) $order->get_billing_last_name() );
?>

<?php if ( '' !== $customer_name ) : ?>
    <p><?php printf( esc_html__( 'Guten Tag %s,', 'ibuture-bacs-email-candidate' ), esc_html( $customer_name ) ); ?></p>
<?php endif; ?>

<p><?php esc_html_e( 'Vielen Dank für Ihre Bestellung.', 'ibuture-bacs-email-candidate' ); ?></p>

<p>
    <strong>
        <?php esc_html_e( 'Ihre Bestellnummer lautet:', 'ibuture-bacs-email-candidate' ); ?>
        <?php echo esc_html( $order->get_order_number() ); ?>
    </strong>
</p>

<p>
    <?php
    esc_html_e(
        'Die Zahlungsanweisungen für Ihre Banküberweisung erhalten Sie in einer separaten E-Mail.',
        'ibuture-bacs-email-candidate'
    );
    ?>
</p>

<p><?php esc_html_e( 'Bitte schließen Sie die Überweisung erst anhand dieser Zahlungsanweisungen ab.', 'ibuture-bacs-email-candidate' ); ?></p>

<?php
do_action( 'woocommerce_email_footer', $email );
