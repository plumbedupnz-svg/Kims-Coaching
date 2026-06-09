# Kim's Coaching Inventory Manual Test Notes

Run `supabase/migrations/20260609000000_create_inventory_system.sql` in Supabase SQL Editor before testing.

## Sportco PDF Invoice Upload

1. Log in as an admin.
2. Open `admin.html#inventory`.
3. Upload a Sportco PDF invoice.
4. Confirm the PDF is stored in the `supplier-invoices` Supabase Storage bucket.
5. Confirm `supplier_invoices` has one new invoice row.
6. Confirm `supplier_invoice_items` has one row for each extracted line item.

## Existing Product Match

1. Create an `inventory_items` row with a known SKU.
2. Upload an invoice containing the same SKU.
3. Confirm the existing item quantity increases.
4. Confirm a `stock_movements` row is created with `movement_type = stock_in`.

## New Flagged Item

1. Upload an invoice with a product name/SKU that does not exist yet.
2. Confirm a new `inventory_items` row is created.
3. Confirm `review_status = new_supplier_item`.
4. Confirm the item appears in Admin -> Inventory -> New items to review.

## Add Flagged Item To Shop

1. In New items to review, enter category, sell price, and description.
2. Click Add to shop.
3. Confirm a `shop_products` row is created.
4. Confirm the inventory item has `visible_in_shop = true`.
5. Confirm the product appears on `shop.html`.

## Merge Flagged Item

1. Upload an invoice that creates a new flagged item.
2. Choose an existing item in the Merge dropdown.
3. Click Merge.
4. Confirm the target item quantity increases.
5. Confirm the source item has `review_status = merged`.
6. Confirm a stock movement records the merge.

## Selling An Item Reduces Stock

1. Add a visible in-stock shop product to the cart.
2. Checkout while logged in as a customer.
3. Confirm `shop_orders` has a new `pending_payment` row.
4. Confirm the matching `inventory_items.quantity_on_hand` is reduced.
5. Confirm `stock_movements` has a `stock_out` row linked to the shop order.

## Out Of Stock Prevention

1. Set an item's quantity to `0`.
2. Confirm the public shop shows Out of stock, or hides it if the admin setting is enabled.
3. Try to checkout with more quantity than available.
4. Confirm checkout is blocked before redirecting to Stripe.
