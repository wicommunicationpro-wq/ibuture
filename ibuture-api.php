<?php
/**
 * IBUTURE API
 *
 * Couche API entre le frontend IBUTURE et WooCommerce.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {

    register_rest_route('ibuture/v1', '/products', [
        'methods'  => WP_REST_Server::READABLE,
        'callback' => 'ibuture_api_products',
        'permission_callback' => '__return_true',
        'args' => [
            'page' => [
                'default'           => 1,
                'sanitize_callback' => 'absint',
            ],
            'per_page' => [
                'default'           => 12,
                'sanitize_callback' => 'absint',
            ],
            'slug' => [
                'default'           => '',
                'sanitize_callback' => function($value) { return sanitize_title($value); },
            ],
            'search' => [
                'default'           => '',
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ],
    ]);

});

function ibuture_api_products(WP_REST_Request $request) {

    if (!function_exists('wc_get_products')) {
        return new WP_Error(
            'woocommerce_unavailable',
            'WooCommerce n’est pas disponible.',
            ['status' => 503]
        );
    }

    $page     = max(1, (int) $request->get_param('page'));
    $per_page = min(50, max(1, (int) $request->get_param('per_page')));
    $slug     = sanitize_title($request->get_param('slug'));
    $search   = trim((string) $request->get_param('search'));

    $query_args = [
        'status'   => 'publish',
        'limit'    => $per_page,
        'page'     => $page,
        'paginate' => true,
        'orderby'  => 'menu_order',
        'order'    => 'ASC',
    ];

    if ($slug) {
        $post = get_page_by_path($slug, OBJECT, 'product');
        $query_args['include'] = $post ? [$post->ID] : [0];
    } elseif ($search !== '') {
        $query_args['s'] = $search;
    }

    $products = wc_get_products($query_args);

    if (!$slug && $search !== '' && empty($products->products)) {
        $sku_query_args = $query_args;
        unset($sku_query_args['s']);
        $sku_query_args['sku'] = $search;
        $products = wc_get_products($sku_query_args);
    }

    if (!$slug && $search !== '' && empty($products->products) && function_exists('wc_get_product_id_by_sku')) {
        $variation_id = wc_get_product_id_by_sku($search);
        $variation = $variation_id ? wc_get_product($variation_id) : false;
        $parent_id = $variation && $variation->is_type('variation') ? $variation->get_parent_id() : 0;

        if ($parent_id && get_post_status($parent_id) === 'publish') {
            $parent_query_args = $query_args;
            unset($parent_query_args['s']);
            $parent_query_args['include'] = [$parent_id];
            $products = wc_get_products($parent_query_args);
        }
    }

    $data = [];

    foreach ($products->products as $product) {

        $item = [
            'id'          => $product->get_id(),
            'name'        => $product->get_name(),
            'slug'        => $product->get_slug(),
            'type'        => $product->get_type(),
            'price'       => $product->get_price(),
            'regular_price' => $product->get_regular_price(),
            'sale_price'  => $product->get_sale_price(),
            'sku'         => $product->get_sku(),
            'stock_status' => $product->get_stock_status(),
            'permalink'   => $product->get_permalink(),
            'image'       => null,
            'gallery'     => [],
            'categories'  => [],
            'description' => $product->get_description(),
            'short_description' => $product->get_short_description(),
            'variations'  => [],
        ];

        $image_id = $product->get_image_id();

        if ($image_id) {
            $item['image'] = [
                'id'  => $image_id,
                'url' => wp_get_attachment_image_url($image_id, 'full'),
            ];
        }

        foreach ($product->get_gallery_image_ids() as $image_id) {
            $url = wp_get_attachment_image_url($image_id, 'full');

            if ($url) {
                $item['gallery'][] = [
                    'id'  => $image_id,
                    'url' => $url,
                ];
            }
        }

        foreach ($product->get_category_ids() as $category_id) {
            $item['categories'][] = [
                'id'   => $category_id,
                'name' => get_term($category_id, 'product_cat')->name,
                'slug' => get_term($category_id, 'product_cat')->slug,
            ];
        }

        if ($product->is_type('variable')) {

            foreach ($product->get_children() as $variation_id) {

                $variation = wc_get_product($variation_id);

                if (!$variation) {
                    continue;
                }

                $variation_data = [
                    'id'            => $variation->get_id(),
                    'sku'           => $variation->get_sku(),
                    'shopify_variant_id' => get_post_meta($variation->get_id(), 'ibuture_shopify_variant_id', true),                
                    'price'         => $variation->get_price(),
                    'regular_price' => $variation->get_regular_price(),
                    'sale_price'    => $variation->get_sale_price(),
                    'stock_status'  => $variation->get_stock_status(),
                    'attributes'    => $variation->get_attributes(),
                    'image'         => null,
                ];

                $variation_image_id = $variation->get_image_id();

                if ($variation_image_id) {
                    $variation_data['image'] = [
                        'id'  => $variation_image_id,
                        'url' => wp_get_attachment_image_url(
                            $variation_image_id,
                            'full'
                        ),
                        'thumbnail' => wp_get_attachment_image_url($variation_image_id, 'woocommerce_thumbnail'),
                    ];
                }

                $item['variations'][] = $variation_data;
            }
        }

        $data[] = $item;
    }

    return rest_ensure_response([
        'success' => true,
        'data' => $data,
        'pagination' => [
            'page'        => $page,
            'per_page'    => $per_page,
            'total'       => (int) $products->total,
            'total_pages' => (int) $products->max_num_pages,
        ],
    ]);
}

add_action('rest_api_init', function () {

    register_rest_route('ibuture/v1', '/cart/add', [
        'methods'  => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_cart_add',
        'permission_callback' => '__return_true',
        'args' => [
            'product_id' => [
                'required' => true,
                'sanitize_callback' => 'absint',
            ],
            'variation_id' => [
                'required' => false,
                'default' => 0,
                'sanitize_callback' => 'absint',
            ],
            'quantity' => [
                'required' => false,
                'default' => 1,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

});

function ibuture_api_localized_cart_data(WP_REST_Request $request) {
    $name = sanitize_text_field((string) $request->get_param('localized_name'));
    $variation = sanitize_text_field((string) $request->get_param('localized_variation'));
    $locale = sanitize_key((string) $request->get_param('localized_locale'));

    if (strlen($name) > 500) {
        $name = substr($name, 0, 500);
    }

    if (strlen($variation) > 200) {
        $variation = substr($variation, 0, 200);
    }

    if (!preg_match('/^[a-z]{2}$/', $locale)) {
        $locale = '';
    }

    return [
        'ibuture_localized_name'      => $name,
        'ibuture_localized_variation' => $variation,
        'ibuture_localized_locale'    => $locale,
    ];
}

function ibuture_api_cart_item_name($cart_item) {
    if (!empty($cart_item['ibuture_localized_name'])) {
        return (string) $cart_item['ibuture_localized_name'];
    }

    return $cart_item['data']->get_name();
}

function ibuture_api_cart_item_variation($cart_item) {
    if (!empty($cart_item['ibuture_localized_variation'])) {
        return [
            'localized' => (string) $cart_item['ibuture_localized_variation'],
        ];
    }

    return isset($cart_item['variation']) && is_array($cart_item['variation'])
        ? $cart_item['variation']
        : [];
}

function ibuture_api_cart_add(WP_REST_Request $request) {

    if (!function_exists('WC')) {
        return new WP_Error(
            'woocommerce_unavailable',
            'WooCommerce n’est pas disponible.',
            ['status' => 503]
        );
    }

    WC()->initialize_session();
    WC()->initialize_cart();
error_log(
    '[IBUTURE CART DEBUG] session=' .
    WC()->session->get_customer_id() .
    ' cookie=' .
    json_encode(WC()->session->get_session_cookie()) .
    ' before=' .
    WC()->cart->get_cart_contents_count()
);
    $product_id   = (int) $request->get_param('product_id');
    $variation_id = (int) $request->get_param('variation_id');
    $quantity     = max(1, (int) $request->get_param('quantity'));
    $localized_cart_data = ibuture_api_localized_cart_data($request);

    $cart_item_key = WC()->cart->add_to_cart(
        $product_id,
        $quantity,
        $variation_id,
        [],
        $localized_cart_data
    );
error_log(
    '[IBUTURE CART DEBUG] product=' .
    $product_id .
    ' variation=' .
    $variation_id .
    ' key=' .
    $cart_item_key .
    ' after=' .
    WC()->cart->get_cart_contents_count()
);
    if (!$cart_item_key) {
        return new WP_Error(
            'cart_add_failed',
            'Impossible d’ajouter ce produit au panier.',
            ['status' => 400]
        );
    }

    $cart = WC()->cart;

    $items = [];

    foreach ($cart->get_cart() as $key => $cart_item) {

        $product = $cart_item['data'];

        $items[] = [
            'key'          => $key,
            'product_id'   => (int) $cart_item['product_id'],
            'variation_id' => (int) $cart_item['variation_id'],
            'quantity'     => (int) $cart_item['quantity'],
            'name'         => ibuture_api_cart_item_name($cart_item),
            'sku'          => $product->get_sku(),
            'price'        => $product->get_price(),
            'line_total'   => $cart_item['line_total'],
            'variation'    => ibuture_api_cart_item_variation($cart_item),
            'image'        => $product->get_image_id()
                ? wp_get_attachment_image_url($product->get_image_id(), 'woocommerce_thumbnail')
                : null,
        ];
    }
 error_log(
        '[IBUTURE CART DEBUG] FINAL count=' .
        $cart->get_cart_contents_count() .
        ' items=' .
        wp_json_encode($items)
    );
    nocache_headers();

    return rest_ensure_response([
        'success'     => true,
        'added_key'   => $cart_item_key,
        'items_count' => $cart->get_cart_contents_count(),
        'subtotal'    => $cart->get_cart_subtotal(),
        'total'       => $cart->get_cart_total(),
        'items'       => $items,
    ]);
}

add_action('rest_api_init', function () {

    register_rest_route('ibuture/v1', '/cart', [
        'methods'  => WP_REST_Server::READABLE,
        'callback' => 'ibuture_api_cart',
        'permission_callback' => '__return_true',
    ]);

});

function ibuture_api_cart(WP_REST_Request $request) {

    if (!function_exists('WC')) {
        return new WP_Error(
            'woocommerce_unavailable',
            'WooCommerce n’est pas disponible.',
            ['status' => 503]
        );
    }

    WC()->initialize_session();
    WC()->initialize_cart();

    $cart = WC()->cart;
    $items = [];

    foreach ($cart->get_cart() as $key => $cart_item) {

        $product = $cart_item['data'];

        $items[] = [
            'key'          => $key,
            'product_id'   => (int) $cart_item['product_id'],
            'variation_id' => (int) $cart_item['variation_id'],
            'quantity'     => (int) $cart_item['quantity'],
            'name'         => ibuture_api_cart_item_name($cart_item),
            'sku'          => $product->get_sku(),
            'price'        => $product->get_price(),
            'line_total'   => (float) $cart_item['line_total'],
            'variation'    => ibuture_api_cart_item_variation($cart_item),
            'image'        => $product->get_image_id()
                ? wp_get_attachment_image_url(
                    $product->get_image_id(),
                    'woocommerce_thumbnail'
                )
                : null,
        ];
    }

    nocache_headers();

    return rest_ensure_response([
        'success'     => true,
        'items_count' => $cart->get_cart_contents_count(),
        'subtotal'    => $cart->get_cart_subtotal(),
        'total'       => $cart->get_cart_total(),
        'items'       => $items,
    ]);
}

add_action('rest_api_init', function () {

    register_rest_route('ibuture/v1', '/cart/update', [
        'methods'  => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_cart_update',
        'permission_callback' => '__return_true',
        'args' => [
            'key' => [
                'required' => true,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'quantity' => [
                'required' => true,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

});

function ibuture_api_cart_update(WP_REST_Request $request) {

    if (!function_exists('WC')) {
        return new WP_Error(
            'woocommerce_unavailable',
            'WooCommerce n’est pas disponible.',
            ['status' => 503]
        );
    }

    WC()->initialize_session();
    WC()->initialize_cart();

    $key      = sanitize_text_field($request->get_param('key'));
    $quantity = (int) $request->get_param('quantity');

    $cart_items = WC()->cart->get_cart();

    if (!isset($cart_items[$key])) {
        return new WP_Error(
            'cart_item_not_found',
            'Article introuvable dans le panier.',
            ['status' => 404]
        );
    }

    if ($quantity < 1) {
        WC()->cart->remove_cart_item($key);
    } else {
        WC()->cart->set_quantity($key, $quantity, true);
    }

    WC()->cart->calculate_totals();
    WC()->cart->set_session();

    $items = [];

    foreach (WC()->cart->get_cart() as $cart_key => $cart_item) {

        $product = $cart_item['data'];

        $items[] = [
            'key'          => $cart_key,
            'product_id'   => (int) $cart_item['product_id'],
            'variation_id' => (int) $cart_item['variation_id'],
            'quantity'     => (int) $cart_item['quantity'],
            'name'         => $product->get_name(),
            'sku'          => $product->get_sku(),
            'price'        => $product->get_price(),
            'line_total'   => (float) $cart_item['line_total'],
            'variation'    => ibuture_api_cart_item_variation($cart_item),
            'image'        => $product->get_image_id()
                ? wp_get_attachment_image_url(
                    $product->get_image_id(),
                    'woocommerce_thumbnail'
                )
                : null,
        ];
    }

    nocache_headers();

    return rest_ensure_response([
        'success'     => true,
        'items_count' => WC()->cart->get_cart_contents_count(),
        'subtotal'    => WC()->cart->get_cart_subtotal(),
        'total'       => WC()->cart->get_cart_total(),
        'items'       => $items,
    ]);
}

add_action('rest_api_init', function () {

    register_rest_route('ibuture/v1', '/cart/remove', [
        'methods'  => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_cart_remove',
        'permission_callback' => '__return_true',
        'args' => [
            'key' => [
                'required' => true,
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ],
    ]);

});

function ibuture_api_cart_remove(WP_REST_Request $request) {

    if (!function_exists('WC')) {
        return new WP_Error(
            'woocommerce_unavailable',
            'WooCommerce n’est pas disponible.',
            ['status' => 503]
        );
    }

    WC()->initialize_session();
    WC()->initialize_cart();

    $key = sanitize_text_field($request->get_param('key'));

    $cart_items = WC()->cart->get_cart();

    if (!isset($cart_items[$key])) {
        return new WP_Error(
            'cart_item_not_found',
            'Article introuvable dans le panier.',
            ['status' => 404]
        );
    }

    WC()->cart->remove_cart_item($key);
    WC()->cart->calculate_totals();
    WC()->cart->set_session();

    $items = [];

    foreach (WC()->cart->get_cart() as $cart_key => $cart_item) {

        $product = $cart_item['data'];

        $items[] = [
            'key'          => $cart_key,
            'product_id'   => (int) $cart_item['product_id'],
            'variation_id' => (int) $cart_item['variation_id'],
            'quantity'     => (int) $cart_item['quantity'],
            'name'         => ibuture_api_cart_item_name($cart_item),
            'sku'          => $product->get_sku(),
            'price'        => $product->get_price(),
            'line_total'   => (float) $cart_item['line_total'],
            'variation'    => ibuture_api_cart_item_variation($cart_item),
            'image'        => $product->get_image_id()
                ? wp_get_attachment_image_url(
                    $product->get_image_id(),
                    'woocommerce_thumbnail'
                )
                : null,
        ];
    }

    nocache_headers();

    return rest_ensure_response([
        'success'     => true,
        'items_count' => WC()->cart->get_cart_contents_count(),
        'subtotal'    => WC()->cart->get_cart_subtotal(),
        'total'       => WC()->cart->get_cart_total(),
        'items'       => $items,
    ]);
}

/**
 * Autorise les cookies WooCommerce dans le contexte
 * frontend IBUTURE cross-site -> API Hostinger.
 */
add_filter('woocommerce_set_cookie_options', function ($options) {
    $options['samesite'] = 'None';
    $options['secure'] = true;
    return $options;
}, 10, 1);

function ibuture_api_checkout_cors() {
    $request_uri = isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '';
    $is_ibuture_route = strpos($request_uri, '/wp-json/ibuture/v1') !== false;
    $rest_route = isset($_GET['rest_route']) ? (string) $_GET['rest_route'] : '';

    // Autorité CORS unique pour toutes les routes /wp-json/ibuture/v1/*.
    if (!$is_ibuture_route && strpos($rest_route, '/ibuture/v1') !== 0) {
        return;
    }

    $allowed_origins = [
        'https://ibuture.com',
        'https://www.ibuture.com',
        'http://localhost:8083',
        'https://silver-winner-r7grp9559x7jcx7v7-8000.app.github.dev',
        'https://psychic-halibut-g5qgxwx7r5w39jwg-8000.app.github.dev',
        'https://super-succotash-4qvjgqwgpx65f5j9q-8000.app.github.dev',
    ];
    $origin = get_http_origin();
    $origin_allowed = $origin && in_array($origin, $allowed_origins, true);

    header_remove('Access-Control-Allow-Origin');
    header_remove('Access-Control-Allow-Credentials');
    header_remove('Access-Control-Allow-Methods');
    header_remove('Access-Control-Allow-Headers');

    header('Vary: Origin');

    // Protection cache : aucune réponse ibuture/v1 ne doit être partagée
    // entre utilisateurs/origines (nonce, panier, checkout, session).
    if (!defined('DONOTCACHEPAGE')) {
        define('DONOTCACHEPAGE', true);
    }
    nocache_headers();

    if (!$origin_allowed) {
        return;
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, X-WP-Nonce, X-Idempotency-Key');

    // Preflight OPTIONS : réponse directe avec les en-têtes CORS autorisés.
    if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        status_header(204);
        exit;
    }
}

add_action('rest_api_init', 'ibuture_api_checkout_cors', 999);

function ibuture_api_checkout_cors_response($served, $result, $request) {
    if (strpos($request->get_route(), '/ibuture/v1') !== 0) {
        return $served;
    }

    ibuture_api_checkout_cors();
    return $served;
}

add_filter('rest_pre_serve_request', 'ibuture_api_checkout_cors_response', 99, 3);

/**
 * Checkout API: all totals, rates and order data are calculated by WooCommerce.
 */
function ibuture_api_checkout_init() {
    if (!function_exists('WC')) {
        return new WP_Error(
            'woocommerce_unavailable',
            'WooCommerce n’est pas disponible.',
            ['status' => 503]
        );
    }

    WC()->initialize_session();
    WC()->initialize_cart();
    WC()->cart->get_cart();

    return true;
}

function ibuture_api_checkout_permission(WP_REST_Request $request) {
    $nonce = $request->get_header('X-WP-Nonce');
    if (!$nonce || !wp_verify_nonce($nonce, 'wp_rest')) {
        return new WP_Error(
            'rest_cookie_invalid_nonce',
            'Nonce checkout invalide ou absent.',
            ['status' => 403]
        );
    }

    return true;
}

function ibuture_api_checkout_nonce() {
    return rest_ensure_response([
        'success' => true,
        'nonce' => wp_create_nonce('wp_rest'),
    ]);
}

function ibuture_api_checkout_payload(WP_REST_Request $request) {
    $payload = $request->get_json_params();
    return is_array($payload) ? $payload : [];
}

function ibuture_api_checkout_customer_fields() {
    return [
        'first_name',
        'last_name',
        'company',
        'address_1',
        'address_2',
        'city',
        'state',
        'postcode',
        'country',
        'email',
        'phone',
    ];
}

function ibuture_api_checkout_apply_customer(array $payload) {
    $customer = WC()->customer;

    if (!$customer) {
        $customer = new WC_Customer(get_current_user_id());
        WC()->customer = $customer;
    }

    $billing = isset($payload['billing']) && is_array($payload['billing'])
        ? $payload['billing']
        : $payload;
    $shipping = isset($payload['shipping']) && is_array($payload['shipping'])
        ? $payload['shipping']
        : $billing;

    foreach (ibuture_api_checkout_customer_fields() as $field) {
        if (array_key_exists($field, $billing)) {
            $setter = 'set_billing_' . $field;
            if (method_exists($customer, $setter)) {
                $customer->{$setter}(wc_clean($billing[$field]));
            }
        }

        if (array_key_exists($field, $shipping)) {
            $setter = 'set_shipping_' . $field;
            if (method_exists($customer, $setter)) {
                $customer->{$setter}(wc_clean($shipping[$field]));
            }
        }
    }

    $customer->save();
    WC()->session->set('customer', $customer->get_data());
    if (method_exists(WC()->session, 'set_customer_session_cookie')) {
        WC()->session->set_customer_session_cookie(true);
    }
}

function ibuture_api_checkout_customer_data() {
    $data = [
        'payment_method' => '',
        'payment_method_title' => '',
        'terms' => 1,
        'ship_to_different_address' => 1,
    ];

    foreach (ibuture_api_checkout_customer_fields() as $field) {
        $data['billing_' . $field] = WC()->customer->{'get_billing_' . $field}();
        if ($field !== 'email') {
            $data['shipping_' . $field] = WC()->customer->{'get_shipping_' . $field}();
        }
    }

    return $data;
}

function ibuture_api_checkout_validate_customer() {
    $data = ibuture_api_checkout_customer_data();
    $required = [
        'billing_first_name' => 'Prénom de facturation',
        'billing_last_name' => 'Nom de facturation',
        'billing_address_1' => 'Adresse de facturation',
        'billing_city' => 'Ville de facturation',
        'billing_postcode' => 'Code postal de facturation',
        'billing_country' => 'Pays de facturation',
        'billing_email' => 'Email de facturation',
    ];

    foreach ($required as $field => $label) {
        if (empty($data[$field])) {
            return new WP_Error(
                'checkout_required_field',
                $label . ' est obligatoire.',
                ['status' => 400, 'field' => $field]
            );
        }
    }

    if (!is_email($data['billing_email'])) {
        return new WP_Error(
            'checkout_invalid_email',
            'L’adresse email est invalide.',
            ['status' => 400, 'field' => 'billing_email']
        );
    }

    if (!WC()->customer->get_shipping_country()) {
        return new WP_Error(
            'checkout_required_field',
            'Pays de livraison est obligatoire.',
            ['status' => 400, 'field' => 'shipping_country']
        );
    }

    return true;
}

function ibuture_api_checkout_validate_stock() {
    foreach (WC()->cart->get_cart() as $cart_item) {
        $product = $cart_item['data'];
        $quantity = (int) $cart_item['quantity'];
        if (!$product || !$product->is_purchasable() || !$product->is_in_stock()) {
            return new WP_Error('checkout_product_unavailable', 'Un article du panier n’est plus disponible.', ['status' => 400]);
        }
        if (!$product->has_enough_stock($quantity)) {
            return new WP_Error('checkout_insufficient_stock', 'Le stock est insuffisant pour un article du panier.', ['status' => 400]);
        }
    }

    return true;
}

function ibuture_api_checkout_available_shipping_rates() {
    WC()->cart->calculate_totals();
    $rates = [];
    foreach (WC()->shipping()->get_packages() as $package) {
        foreach ($package['rates'] as $rate_id => $rate) {
            $rates[$rate_id] = $rate;
        }
    }
    return $rates;
}

function ibuture_api_checkout_validate_shipping($shipping_method = '') {
    if (!WC()->cart->needs_shipping()) {
        return true;
    }

    if ($shipping_method === '') {
        return new WP_Error('shipping_method_required', 'Une méthode de livraison est obligatoire.', ['status' => 400]);
    }

    $rates = ibuture_api_checkout_available_shipping_rates();
    if (!isset($rates[$shipping_method])) {
        return new WP_Error('shipping_method_unavailable', 'La méthode de livraison demandée n’est pas disponible.', ['status' => 400]);
    }

    WC()->session->set('chosen_shipping_methods', [$shipping_method]);
    WC()->cart->calculate_totals();
    return true;
}

function ibuture_api_checkout_idempotency_key(WP_REST_Request $request) {
    $key = sanitize_text_field($request->get_header('X-Idempotency-Key'));
    if ($key === '' || strlen($key) > 100) {
        return new WP_Error('idempotency_key_required', 'L’en-tête X-Idempotency-Key est obligatoire.', ['status' => 400]);
    }
    return 'ibuture_checkout_' . md5(WC()->session->get_customer_id() . ':' . $key);
}

function ibuture_api_checkout_lock(WP_REST_Request $request) {
    $option = ibuture_api_checkout_idempotency_key($request);
    if (is_wp_error($option)) {
        return $option;
    }

    $existing = get_option($option);
    if ($existing) {
        if (!empty($existing['response'])) {
            return $existing['response'];
        }
        return new WP_Error('checkout_in_progress', 'Cette tentative de commande est déjà en cours.', ['status' => 409]);
    }

    if (!add_option($option, ['status' => 'processing'], '', 'no')) {
        return new WP_Error('checkout_in_progress', 'Cette tentative de commande est déjà en cours.', ['status' => 409]);
    }

    return $option;
}

function ibuture_api_checkout_summary() {
    WC()->cart->calculate_totals();

    $items = [];

    foreach (WC()->cart->get_cart() as $cart_key => $cart_item) {
        $product = $cart_item['data'];

        $items[] = [
            'key'          => $cart_key,
            'product_id'   => (int) $cart_item['product_id'],
            'variation_id' => (int) $cart_item['variation_id'],
            'quantity'     => (int) $cart_item['quantity'],
            'name'         => ibuture_api_cart_item_name($cart_item),
            'sku'          => $product->get_sku(),
            'price'        => $product->get_price(),
            'line_total'   => (float) $cart_item['line_total'],
            'variation'    => ibuture_api_cart_item_variation($cart_item),
            'image'        => $product->get_image_id()
                ? wp_get_attachment_image_url(
                    $product->get_image_id(),
                    'woocommerce_thumbnail'
                )
                : null,
        ];
    }

    return [
        'items_count' => WC()->cart->get_cart_contents_count(),
        'items' => $items,
        'subtotal' => (float) WC()->cart->get_subtotal(),
        'subtotal_tax' => (float) WC()->cart->get_subtotal_tax(),
        'shipping_total' => (float) WC()->cart->get_shipping_total(),
        'shipping_tax' => (float) WC()->cart->get_shipping_tax(),
        'discount_total' => (float) WC()->cart->get_discount_total(),
        'discount_tax' => (float) WC()->cart->get_discount_tax(),
        'tax_total' => (float) WC()->cart->get_total_tax(),
        'needs_shipping' => WC()->cart->needs_shipping(),
        'applied_coupons' => WC()->cart->get_applied_coupons(),
        'fees' => array_map(
            static function ( $fee ) {
                return [
                    'name'  => (string) $fee->name,
                    'total' => (float) $fee->total,
                    'tax'   => (float) $fee->tax,
                ];
            },
            WC()->cart->get_fees()
        ),
        'total' => (float) WC()->cart->get_total('edit'),
        'currency' => get_woocommerce_currency(),
    ];
}

function ibuture_api_checkout_shipping_methods() {
    $methods = [];

    foreach (ibuture_api_checkout_available_shipping_rates() as $rate_id => $rate) {
            $methods[$rate_id] = [
                'id' => $rate_id,
                'label' => $rate->get_label(),
                'cost' => (float) $rate->get_cost(),
                'tax' => (float) array_sum($rate->get_taxes()),
                'total' => (float) $rate->get_cost() + (float) array_sum($rate->get_taxes()),
            ];
    }

    return array_values($methods);
}

function ibuture_api_checkout_payment_methods() {
    $methods = [];

    foreach (WC()->payment_gateways()->get_available_payment_gateways() as $id => $gateway) {
        $methods[] = [
            'id' => $id,
            'title' => $gateway->get_title(),
            'description' => wp_strip_all_tags($gateway->get_description()),
        ];
    }

    return $methods;
}

function ibuture_api_checkout_get(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    nocache_headers();

    return rest_ensure_response([
        'success' => true,
        'nonce' => wp_create_nonce('wp_rest'),
        'cart' => ibuture_api_checkout_summary(),
        'shipping_methods' => ibuture_api_checkout_shipping_methods(),
        'payment_methods' => ibuture_api_checkout_payment_methods(),
    ]);
}

function ibuture_api_checkout_apply_coupon(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    $payload = ibuture_api_checkout_payload($request);
    $code = isset($payload['code']) ? wc_format_coupon_code($payload['code']) : '';
    if ($code === '') {
        return new WP_Error('coupon_required', 'Le code coupon est obligatoire.', ['status' => 400]);
    }

    if (WC()->cart->has_discount($code)) {
        return new WP_Error(
            'coupon_already_applied',
            'Ce coupon est déjà appliqué.',
            ['status' => 400]
        );
    }

    wc_clear_notices();
    WC()->cart->apply_coupon($code);
    $errors = wc_get_notices('error');
    wc_clear_notices();
    if (!empty($errors)) {
        return new WP_Error('coupon_invalid', wp_strip_all_tags($errors[0]['notice']), ['status' => 400]);
    }

    WC()->cart->calculate_totals();
    WC()->cart->set_session();
    return rest_ensure_response(['success' => true, 'cart' => ibuture_api_checkout_summary()]);
}

function ibuture_api_checkout_remove_coupon(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    $payload = ibuture_api_checkout_payload($request);
    $code = isset($payload['code']) ? wc_format_coupon_code($payload['code']) : '';
    if ($code === '' || !WC()->cart->has_discount($code)) {
        return new WP_Error('coupon_not_applied', 'Ce coupon n’est pas appliqué.', ['status' => 400]);
    }

    WC()->cart->remove_coupon($code);
    WC()->cart->calculate_totals();
    WC()->cart->set_session();
    return rest_ensure_response(['success' => true, 'cart' => ibuture_api_checkout_summary()]);
}

function ibuture_api_checkout_customer(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    ibuture_api_checkout_apply_customer(ibuture_api_checkout_payload($request));

    return rest_ensure_response([
        'success' => true,
        'cart' => ibuture_api_checkout_summary(),
    ]);
}

function ibuture_api_checkout_shipping(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    $payload = ibuture_api_checkout_payload($request);
    if (isset($payload['billing']) || isset($payload['shipping'])) {
        ibuture_api_checkout_apply_customer($payload);
    }

    $shipping_method = isset($payload['shipping_method'])
        ? sanitize_text_field($payload['shipping_method'])
        : '';

    $shipping_validation = ibuture_api_checkout_validate_shipping($shipping_method);
    if (is_wp_error($shipping_validation)) {
        return $shipping_validation;
    }

    WC()->cart->calculate_totals();

    return rest_ensure_response([
        'success' => true,
        'shipping_methods' => ibuture_api_checkout_shipping_methods(),
        'cart' => ibuture_api_checkout_summary(),
    ]);
}

function ibuture_api_checkout_payments(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    nocache_headers();

    return rest_ensure_response([
        'success' => true,
        'payment_methods' => ibuture_api_checkout_payment_methods(),
        'cart' => ibuture_api_checkout_summary(),
    ]);
}

function ibuture_api_checkout_payment_method(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    $payload = ibuture_api_checkout_payload($request);
    $payment_method = isset($payload['payment_method'])
        ? sanitize_text_field($payload['payment_method'])
        : '';
    $gateways = WC()->payment_gateways()->get_available_payment_gateways();

    if ($payment_method === '' || !isset($gateways[$payment_method])) {
        return new WP_Error(
            'invalid_payment_method',
            'Le moyen de paiement demandé n’est pas disponible.',
            ['status' => 400]
        );
    }

    WC()->session->set('chosen_payment_method', $payment_method);
    WC()->cart->calculate_totals();
    WC()->cart->set_session();

    return rest_ensure_response([
        'success' => true,
        'cart' => ibuture_api_checkout_summary(),
    ]);
}

add_action('woocommerce_checkout_create_order_line_item', function ($item, $cart_item_key, $values, $order) {
    if (!empty($values['ibuture_localized_name'])) {
        $item->set_name((string) $values['ibuture_localized_name']);
    }
}, 10, 4);

function ibuture_api_checkout_order(WP_REST_Request $request) {
    $initialized = ibuture_api_checkout_init();
    if (is_wp_error($initialized)) {
        return $initialized;
    }

    if (WC()->cart->is_empty()) {
        return new WP_Error('empty_cart', 'Le panier est vide.', ['status' => 400]);
    }

    $payload = ibuture_api_checkout_payload($request);
    ibuture_api_checkout_apply_customer($payload);

    $customer_validation = ibuture_api_checkout_validate_customer();
    if (is_wp_error($customer_validation)) {
        return $customer_validation;
    }

    $stock_validation = ibuture_api_checkout_validate_stock();
    if (is_wp_error($stock_validation)) {
        return $stock_validation;
    }

    $gateways = WC()->payment_gateways()->get_available_payment_gateways();
    if (empty($gateways)) {
        return new WP_Error(
            'no_payment_gateway',
            'Aucun moyen de paiement n’est configuré.',
            ['status' => 503]
        );
    }

    $payment_method = isset($payload['payment_method'])
        ? sanitize_text_field($payload['payment_method'])
        : '';
    if ($payment_method === '' || !isset($gateways[$payment_method])) {
        return new WP_Error(
            'invalid_payment_method',
            'Le moyen de paiement demandé n’est pas disponible.',
            ['status' => 400]
        );
    }

    WC()->session->set('chosen_payment_method', $payment_method);

    $shipping_method = isset($payload['shipping_method'])
        ? sanitize_text_field($payload['shipping_method'])
        : '';
    $shipping_validation = ibuture_api_checkout_validate_shipping($shipping_method);
    if (is_wp_error($shipping_validation)) {
        return $shipping_validation;
    }

    WC()->cart->calculate_totals();

    $posted_data = ibuture_api_checkout_customer_data();
    $posted_data['payment_method'] = $payment_method;
    $posted_data['payment_method_title'] = $gateways[$payment_method]->get_title();

    $lock = ibuture_api_checkout_lock($request);
    if (is_wp_error($lock)) {
        return $lock;
    }
    if (is_array($lock)) {
        return rest_ensure_response($lock);
    }

    try {
        $order_id = WC()->checkout()->create_order($posted_data);
    } catch (Throwable $exception) {
        update_option($lock, ['status' => 'failed', 'response' => [
            'success' => false,
            'code' => 'order_creation_failed',
            'message' => 'La commande n’a pas pu être créée.',
        ]], false);
        return new WP_Error(
            'order_creation_failed',
            'La commande n’a pas pu être créée.',
            ['status' => 400]
        );
    }

    if (is_wp_error($order_id)) {
        update_option($lock, ['status' => 'failed', 'response' => [
            'success' => false,
            'code' => $order_id->get_error_code(),
            'message' => $order_id->get_error_message(),
        ]], false);
        return new WP_Error($order_id->get_error_code(), $order_id->get_error_message(), ['status' => 400]);
    }

    $order = wc_get_order($order_id);
    try {
        $payment_result = $gateways[$payment_method]->process_payment($order_id);
    } catch (Throwable $exception) {
        $order->update_status('failed', $exception->getMessage());
        update_option($lock, ['status' => 'failed', 'order_id' => $order_id, 'response' => [
            'success' => false,
            'code' => 'payment_exception',
            'message' => 'Le paiement n’a pas pu être traité.',
            'order_id' => $order_id,
        ]], false);
        return new WP_Error(
            'payment_exception',
            'Le paiement n’a pas pu être traité.',
            ['status' => 502, 'order_id' => $order_id]
        );
    }

    if (is_wp_error($payment_result)) {
        $order->update_status('failed', $payment_result->get_error_message());
        update_option($lock, ['status' => 'failed', 'order_id' => $order_id, 'response' => [
            'success' => false,
            'code' => $payment_result->get_error_code(),
            'message' => $payment_result->get_error_message(),
            'order_id' => $order_id,
        ]], false);
        return new WP_Error(
            $payment_result->get_error_code(),
            $payment_result->get_error_message(),
            ['status' => 400, 'order_id' => $order_id]
        );
    }

    if (!is_array($payment_result) || ($payment_result['result'] ?? '') !== 'success') {
        $message = is_array($payment_result) && !empty($payment_result['messages'])
            ? wp_strip_all_tags($payment_result['messages'])
            : 'Le paiement a été refusé par le gateway.';
        $order->update_status('failed', $message);
        update_option($lock, ['status' => 'failed', 'order_id' => $order_id, 'response' => [
            'success' => false,
            'code' => 'payment_failed',
            'message' => $message,
            'order_id' => $order_id,
        ]], false);
        return new WP_Error('payment_failed', $message, ['status' => 402, 'order_id' => $order_id]);
    }

    WC()->cart->empty_cart(true);

    $response = [
        'success' => true,
        'order_id' => $order_id,
        'order_key' => $order->get_order_key(),
        'redirect' => isset($payment_result['redirect']) ? $payment_result['redirect'] : '',
    ];
    update_option($lock, ['status' => 'completed', 'order_id' => $order_id, 'response' => $response], false);
    return rest_ensure_response($response);
}

add_action('rest_api_init', function () {
    register_rest_route('ibuture/v1', '/checkout/nonce', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'ibuture_api_checkout_nonce',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('ibuture/v1', '/checkout', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'ibuture_api_checkout_get',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('ibuture/v1', '/checkout/customer', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_checkout_customer',
        'permission_callback' => 'ibuture_api_checkout_permission',
    ]);

    register_rest_route('ibuture/v1', '/checkout/shipping', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_checkout_shipping',
        'permission_callback' => 'ibuture_api_checkout_permission',
    ]);

    register_rest_route('ibuture/v1', '/checkout/payment-methods', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'ibuture_api_checkout_payments',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('ibuture/v1', '/checkout/payment-method', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_checkout_payment_method',
        'permission_callback' => 'ibuture_api_checkout_permission',
    ]);

    register_rest_route('ibuture/v1', '/checkout/order', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_checkout_order',
        'permission_callback' => 'ibuture_api_checkout_permission',
    ]);

    register_rest_route('ibuture/v1', '/checkout/apply-coupon', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_checkout_apply_coupon',
        'permission_callback' => 'ibuture_api_checkout_permission',
    ]);

    register_rest_route('ibuture/v1', '/checkout/remove-coupon', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'ibuture_api_checkout_remove_coupon',
        'permission_callback' => 'ibuture_api_checkout_permission',
    ]);
});
