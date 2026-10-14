<?php
/**
 * Plugin Name: IBUTURE BACS Email Candidate
 * Description: Candidate extension for separate BACS order emails; leave inactive pending approval.
 * Version: 1.0.0
 * Text Domain: ibuture-bacs-email-candidate
 * Domain Path: /languages
 */
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_action(
    'plugins_loaded',
    function () {
        load_plugin_textdomain(
            'ibuture-bacs-email-candidate',
            false,
            dirname( plugin_basename( __FILE__ ) ) . '/languages'
        );
    },
    20
);

/**
 * Register the candidate email and scope the short confirmation to BACS.
 */
add_filter(
    'woocommerce_email_classes',
    function ( $emails ) {
        if ( ! class_exists( 'WC_Email' ) ) {
            return $emails;
        }

        $class_file = dirname( __FILE__ )
            . '/ibuture-email-candidate/class-ibuture-bacs-instructions.php';

        if ( is_readable( $class_file ) ) {
            require_once $class_file;

            if ( class_exists( 'IBUTURE_Email_BACS_Instructions' ) ) {
                $emails['IBUTURE_Email_BACS_Instructions']
                    = new IBUTURE_Email_BACS_Instructions();
            }
        }

        $native_key = 'WC_Email_Customer_On_Hold_Order';
        if ( ! class_exists( $native_key )
            || ! isset( $emails[ $native_key ] )
            || ! ( $emails[ $native_key ] instanceof WC_Email_Customer_On_Hold_Order )
        ) {
            return $emails;
        }

        $native_email = $emails[ $native_key ];
        foreach (
            array(
                    'woocommerce_order_status_pending_to_on-hold_notification',
                    'woocommerce_order_status_failed_to_on-hold_notification',
                    'woocommerce_order_status_cancelled_to_on-hold_notification',
            ) as $hook
        ) {
            remove_action( $hook, array( $native_email, 'trigger' ), 10 );
        }

        if ( ! class_exists( 'IBUTURE_Candidate_Customer_On_Hold_Order', false ) ) {
            class IBUTURE_Candidate_Customer_On_Hold_Order extends WC_Email_Customer_On_Hold_Order {
                    public function get_subject() {
                        if ( $this->object instanceof WC_Order
                            && 'bacs' === $this->object->get_payment_method()
                            && 'on-hold' === $this->object->get_status()
                        ) {
                            return __( 'Wir haben Ihre Bestellung erhalten', 'ibuture-bacs-email-candidate' );
                        }

                        return parent::get_subject();
                    }

                    private function clear_stale_candidate_template_cache( $plain_text ) {
                        $template_name = $plain_text
                            ? 'emails/plain/customer-on-hold-order.php'
                            : 'emails/customer-on-hold-order.php';
                        $cache_key = sanitize_key(
                            implode(
                                '-',
                                array( 'template', $template_name, '', '', WC_VERSION )
                            )
                        );
                        $cached_template = wp_cache_get( $cache_key, 'woocommerce' );

                        if ( is_string( $cached_template )
                            && false !== strpos( $cached_template, 'ibuture-email-candidate' )
                        ) {
                            wp_cache_delete( $cache_key, 'woocommerce' );
                        }
                    }

                    private function get_bacs_short_content( $plain_text ) {
                        if ( ! $this->object instanceof WC_Order
                            || 'bacs' !== $this->object->get_payment_method()
                            || 'on-hold' !== $this->object->get_status()
                        ) {
                            return null;
                        }

                        $template_path = $plain_text
                            ? 'emails/plain/customer-on-hold-order.php'
                            : 'emails/customer-on-hold-order.php';
                        $template_name = 'ibuture-candidate/' . $template_path;
                        $candidate = dirname( __FILE__ )
                            . '/ibuture-email-candidate/templates/' . $template_path;

                        if ( ! is_readable( $candidate ) ) {
                            return null;
                        }

                        $template_property = $plain_text ? 'template_plain' : 'template_html';
                        $original_template = $this->{$template_property};
                        $this->{$template_property} = $template_name;
                        $template_filter = function ( $template, $requested_template, $template_path ) use ( $template_name, $candidate ) {
                            return $template_name === $requested_template ? $candidate : $template;
                        };
                        add_filter( 'woocommerce_locate_template', $template_filter, 9999, 3 );
                        $locale_switched = function_exists( 'switch_to_locale' )
                            && switch_to_locale( 'de_DE' );

                        try {
                            return $plain_text ? parent::get_content_plain() : parent::get_content_html();
                        } finally {
                            if ( $locale_switched ) {
                                restore_previous_locale();
                            }
                            remove_filter( 'woocommerce_locate_template', $template_filter, 9999 );
                            $this->{$template_property} = $original_template;
                        }
                    }

                    public function get_content_html() {
                        $content = $this->get_bacs_short_content( false );
                        if ( null === $content ) {
                            $this->clear_stale_candidate_template_cache( false );
                        }
                        return null === $content ? parent::get_content_html() : $content;
                    }

                    public function get_content_plain() {
                        $content = $this->get_bacs_short_content( true );
                        if ( null === $content ) {
                            $this->clear_stale_candidate_template_cache( true );
                        }
                        return null === $content ? parent::get_content_plain() : $content;
                    }
            }
        }

        $emails[ $native_key ] = new IBUTURE_Candidate_Customer_On_Hold_Order();
        return $emails;
    }
);

add_action(
    'wp',
    function () {
        if ( ! function_exists( 'WC' ) ) {
            return;
        }

        $woocommerce = WC();
        if ( ! $woocommerce || ! $woocommerce->payment_gateways() ) {
            return;
        }

        $gateways = $woocommerce->payment_gateways()->payment_gateways();
        if ( isset( $gateways['bacs'] ) && is_object( $gateways['bacs'] ) ) {
            remove_action(
                'woocommerce_thankyou_bacs',
                array( $gateways['bacs'], 'thankyou_page' )
            );
        }
    },
    20
);
