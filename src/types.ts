// Minimal subset of the ACP 2026-04-17 schemas needed for a mock merchant.
// Only fields this sandbox actually reads/writes are typed; everything
// else on incoming requests is accepted but ignored.

export type Item = {
  id: string;
  name?: string;
  unit_amount?: number;
};

export type Buyer = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone_number?: string;
};

export type Address = {
  name: string;
  line_one: string;
  line_two?: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
};

export type FulfillmentDetails = {
  name?: string;
  phone_number?: string;
  email?: string;
  address?: Address;
};

export type Total = {
  type:
    | "items_base_amount"
    | "items_discount"
    | "subtotal"
    | "discount"
    | "fulfillment"
    | "tax"
    | "fee"
    | "gift_wrap"
    | "tip"
    | "store_credit"
    | "total"
    | "amount_refunded";
  display_text: string;
  amount: number;
  description?: string;
};

export type LineItem = {
  id: string;
  item: Item;
  quantity: number;
  name?: string;
  unit_amount?: number;
  totals: Total[];
};

export type MessageError = {
  type: "error";
  code: string;
  content_type: "plain";
  content: string;
};

export type Link = {
  type: string;
  url: string;
};

export type SessionStatus =
  | "incomplete"
  | "not_ready_for_payment"
  | "ready_for_payment"
  | "completed"
  | "canceled";

export type Order = {
  id: string;
  checkout_session_id: string;
  permalink_url: string;
  order_number: string;
  status: "confirmed";
  line_items: LineItem[];
  totals: Total[];
};

export type CheckoutSession = {
  id: string;
  status: SessionStatus;
  currency: string;
  buyer?: Buyer;
  fulfillment_details?: FulfillmentDetails;
  line_items: LineItem[];
  fulfillment_options: unknown[];
  selected_fulfillment_options?: unknown[];
  totals: Total[];
  messages: MessageError[];
  links: Link[];
  capabilities: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  order?: Order;
};

export type ApiError = {
  type: "invalid_request" | "processing_error" | "service_unavailable";
  code: string;
  message: string;
  param?: string;
};
