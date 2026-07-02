# Yad Tamar Digital Stories Store

# Entity Relationship Diagram (ERD)

Version: 1.0

Status: Architecture Approved

> הומר אוטומטית מ-`Yad Tamar Digital Stories Store ERD.docx` (שורש הפרויקט).

# 1. Design Principles

- PostgreSQL is the system of record.
- Google Drive stores audio files only.
- Google Apps Script performs fulfillment operations.
- Every order must exist before payment processing.
- Every payment must be linked to an order.
- Every fulfillment request must be traceable.
- Orders are never physically deleted.
- Delivered content remains available indefinitely.

# 2. Customer

**Purpose**

Represents a customer who purchases content or submits a lead.

**Fields**

- id (UUID, PK)
- full_name
- email
- phone
- created_at
- updated_at

**Constraints**

- email required

**Relationships**

- One Customer → Many Orders
- One Customer → Many Email Logs

# 3. Category

**Purpose**

Groups stories into business categories.

**Fields**

- id (UUID, PK)
- name
- display_order
- is_active
- created_at

**Relationships**

- One Category → Many Stories

# 4. Story

**Purpose**

Represents a purchasable audio story.

**Fields**

- id (UUID, PK)
- story_code (Unique)
- category_id (FK)
- title
- google_drive_file_id
- duration_seconds (Nullable)
- is_active
- created_at
- updated_at

**Constraints**

- story_code unique
- google_drive_file_id required

**Examples**

- YT-0001
- YT-0002
- YT-0003

**Relationships**

- One Story → Many Order Items
- One Category → Many Stories

# 5. PricingRule

**Purpose**

Stores quantity pricing tiers and pricing history.

**Fields**

- id (UUID, PK)
- minimum_quantity
- maximum_quantity
- unit_price
- effective_from
- effective_until (Nullable)
- is_active
- created_at

**Purpose**

Allows future price changes without affecting historical orders.

# 6. Order

**Purpose**

Represents a customer purchase.

**Fields**

- id (UUID, PK)
- order_number (Unique)
- customer_id (FK)
- order_type
- delivery_type
- payment_type
- payment_status
- processing_status
- subtotal_amount
- usb_amount
- total_amount
- folder_url (Nullable)
- office_notes (Nullable)
- created_at
- updated_at

**Order Types**

- STORY_SELECTION
- FULL_LIBRARY
- ADULT_COLLECTION

**Delivery Types**

- SELECTED_STORIES
- MASTER_LIBRARY
- ADULT_COLLECTION
- GIFT_STORY

**Payment Types**

- CREDIT_CARD
- BANK_TRANSFER
- CALLBACK

**Payment Status**

- PENDING
- PAID
- FAILED
- CANCELLED

**Processing Status**

- CREATED
- WAITING_PAYMENT
- READY_FOR_FULFILLMENT
- PROCESSING
- COMPLETED
- FAILED

**Constraints**

- order_number unique
- total_amount >= 0

**Relationships**

- One Order → Many Order Items
- One Order → Many Payments
- One Order → One Fulfillment Request
- One Order → Many Email Logs

# 7. OrderItem

**Purpose**

Stores purchased stories.

**Fields**

- id (UUID, PK)
- order_id (FK)
- story_id (FK)
- story_code_snapshot
- story_title_snapshot
- unit_price
- created_at

**Purpose**

Preserves historical order information even if story metadata changes later.

**Relationships**

- Many Order Items → One Order
- Many Order Items → One Story

# 8. Payment

**Purpose**

Stores payment attempts and payment confirmations.

**Fields**

- id (UUID, PK)
- order_id (FK)
- provider
- provider_transaction_id
- amount
- status
- raw_response_json
- created_at

**Provider**

- HYP

**Status**

- PENDING
- APPROVED
- FAILED

**Constraints**

- provider_transaction_id unique when present

**Relationships**

- Many Payments → One Order

# 9. FulfillmentRequest

**Purpose**

Tracks communication with the external Google Apps Script fulfillment service.

**Fields**

- id (UUID, PK)
- order_id (FK)
- request_status
- attempts_count
- shared_email
- shared_at
- sharing_status
- external_folder_id
- external_folder_url
- error_code
- error_message
- request_sent_at
- response_received_at
- created_at
- updated_at

**Request Status**

- PENDING
- SENT
- COMPLETED
- FAILED

**Sharing Status**

- PENDING
- SHARED
- FAILED

**Constraints**

- One FulfillmentRequest per Order

**Relationships**

- One Order → One FulfillmentRequest

# 10. EmailLog

**Purpose**

Tracks all outgoing emails.

**Fields**

- id (UUID, PK)
- order_id (Nullable FK)
- customer_id (Nullable FK)
- email_type
- recipient_email
- send_status
- sent_at
- created_at

**Email Types**

- PURCHASE_CONFIRMATION
- FILE_DELIVERY
- GIFT_STORY
- OFFICE_NOTIFICATION
- ERROR_NOTIFICATION

**Send Status**

- PENDING
- SENT
- FAILED

**Relationships**

- Many Email Logs → One Customer
- Many Email Logs → One Order

# 11. Lead

**Purpose**

Stores non-purchasing contacts.

**Examples**

- Gift Story Request
- Callback Request
- Marketing Lead

**Fields**

- id (UUID, PK)
- full_name
- email
- phone
- source
- gift_sent
- created_at

**Constraints**

- email required

# 12. AdminUser

**Purpose**

Administrative access to the system.

**Fields**

- id (UUID, PK)
- email
- password_hash
- is_active
- last_login_at
- created_at

**MVP Decision**

- Single Admin User

Future versions may support multiple administrators.

# 13. Entity Relationships

- Customer ─┬─< Order ─┬─< EmailLog
- Category ──< Story
- Story ──< OrderItem
- Order ─┬─< OrderItem
         ├─< Payment
         ├─< EmailLog
         └─1 FulfillmentRequest
- Customer ──< Lead (optional business relationship)

# 14. Required Database Constraints

- **DC-01** — Order Number must be unique.
- **DC-02** — Story Code must be unique.
- **DC-03** — Customer Email is required.
- **DC-04** — Google Drive File ID is required.
- **DC-05** — Order Total Amount cannot be negative.
- **DC-06** — Paid Orders cannot return to Pending status.
- **DC-07** — Provider Transaction ID must be unique when supplied.
- **DC-08** — Each Order may have only one Fulfillment Request.
- **DC-09** — Order Item snapshots must be preserved permanently.

# 15. Out of Scope (MVP)

- Automatic file deletion
- Automatic folder deletion
- Share revocation management
- Role-based permissions
- CRM features
- Marketing automation
- Customer history management
- Advanced analytics
- Audit logging

# 16. External System Boundaries

**External Fulfillment Service**

Technology: Google Apps Script

**Responsibilities:**

- Create Google Drive folders
- Copy files
- Share folders
- Return fulfillment results

**Platform Responsibilities:**

- Build fulfillment requests
- Send file identifiers
- Track fulfillment status
- Store fulfillment outcomes

The platform does not directly manage Google Drive operations.
