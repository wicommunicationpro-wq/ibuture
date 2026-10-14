<?php
defined( 'ABSPATH' ) || exit;

$customer_name = trim( (string) $order->get_billing_first_name() . ' ' . (string) $order->get_billing_last_name() );
if ( '' !== $customer_name ) {
    printf( __( 'Guten Tag %s,', 'ibuture-bacs-email-candidate' ) . "\n\n", wp_strip_all_tags( $customer_name ) );
}
echo __( 'Wir haben Ihre Bestellung erhalten', 'ibuture-bacs-email-candidate' ) . "\n\n";
echo __( 'Vielen Dank für Ihre Bestellung.', 'ibuture-bacs-email-candidate' ) . "\n\n";
echo __( 'Ihre Bestellnummer lautet:', 'ibuture-bacs-email-candidate' ) . ' ';
echo wp_strip_all_tags( (string) $order->get_order_number() );
echo "\n\n";

echo __( 'Die Zahlungsanweisungen für Ihre Banküberweisung erhalten Sie in einer separaten E-Mail.', 'ibuture-bacs-email-candidate' ) . "\n\n";
echo __( 'Bitte schließen Sie die Überweisung erst anhand dieser Zahlungsanweisungen ab.', 'ibuture-bacs-email-candidate' ) . "\n";
