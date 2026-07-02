# Yad Tamar Digital Audio Library Platform

## Product Requirements Document (PRD)

### MVP Version 1.1

> הומר אוטומטית מ-`Yad Tamar Digital Audio Library Platform PRD.docx` (שורש הפרויקט).

# 1. Executive Summary

Yad Tamar requires a desktop-based e-commerce platform for selling and delivering digital audio content.

The platform will allow customers to browse audio stories, calculate pricing dynamically, place orders, complete payments, and receive access to purchased content through Google Drive.

The solution aims to automate the majority of the sales and fulfillment process while providing operational visibility through an administration dashboard.

# 2. Problem Statement

The current process relies heavily on manual operations, including:

- Order handling
- Price calculation
- File preparation
- Content delivery
- Customer communication
- Payment tracking

This creates operational overhead, fulfillment delays, and risk of human error.

The platform should automate these processes while maintaining simple administrative oversight.

# 3. Target Users

## Customers

Individuals purchasing digital audio stories and educational content.

### Goals

- Simple purchasing process
- Clear pricing
- Fast content delivery
- Reliable access to purchased content

## Office Staff

Responsible for handling manual follow-up cases.

### Goals

- Track orders
- Monitor payment status
- Manage leads
- Resolve fulfillment issues

## Administrator

Responsible for operational monitoring and maintenance.

### Goals

- Monitor platform activity
- Manage orders
- Refresh catalog data
- Track fulfillment status

# 4. Value Proposition

## Customer Value

- Easy story selection
- Transparent pricing
- Automated delivery
- Immediate access after payment

## Business Value

- Reduced manual workload
- Improved operational efficiency
- Centralized order management
- Improved customer experience

# 5. Business Goals

- Automate at least 80% of paid credit-card orders.
- Reduce fulfillment effort performed by office staff.
- Improve operational visibility.
- Centralize customer orders and leads.
- Deliver purchased content automatically.

# 6. Success Metrics

| Metric | Target |
| --- | --- |
| Automated credit-card fulfillment | ≥ 80% |
| System error rate | < 2% |
| Average fulfillment time | < 5 minutes |
| Order persistence | 100% |
| Payment tracking accuracy | 100% |

# 7. Product Catalog

## Children's Audio Library

Inventory:

- 423 children's audio stories
- 5 Gemara audio files

Total: 428 audio files

### Pricing

| Quantity | Price Per File |
| --- | --- |
| 1–49 | ₪8 |
| 50–99 | ₪7.5 |
| 100–149 | ₪7 |
| 150–314 | ₪6 |
| 315+ | ₪4.3 |

## Full Children's Library

- 428 files
- Fixed bundle price: ₪1,550

This is a dedicated bundle product.

## Adult & Youth Collection

- 24 MP3 collections
- Approximately 283 lectures

Fixed price: ₪360

This collection is sold separately and is not included in the children's library bundle.

# 8. Story Catalog Requirements

Each story shall contain:

- Story Code
- Story Name
- Category
- Google Drive File ID
- Sort Order
- Active Status

### Story Code Requirements

- Unique across the catalog
- Immutable after creation
- Searchable in administration screens
- Included in order details
- Included in operational reports

# 9. USB Delivery

- USB cost: ₪15
- Free USB for orders containing 50 or more files
- Shipping handled manually outside the platform

# 10. MVP Scope

## In Scope

- Desktop-only website
- Hebrew RTL interface
- Story browsing and selection
- Dynamic pricing
- Order creation
- Payment processing
- Lead collection
- Gift Story flow
- Email notifications
- Google Sheets integration
- External fulfillment integration
- Administration dashboard

## Out of Scope

- Mobile support
- Invoice generation
- Role-based permissions
- Audit logs
- CRM functionality
- WhatsApp integration
- CSV/Excel export
- Manual order creation
- Automatic file deletion
- Automatic folder deletion
- Share revocation management

# 11. Payment Methods

## Credit Card

- Online payment processing
- Automatic fulfillment request
- Customer receives confirmation email

## Bank Transfer

- Order created
- Payment completed manually
- Office staff manages follow-up

## Cash / Call Me Back

- Order created
- Office staff performs manual follow-up

# 12. External Fulfillment Service

The platform integrates with an external Google Apps Script fulfillment service.

### Fulfillment Request

The platform sends:

- Order ID
- Customer Email
- List of Google Drive File IDs

### External Service Responsibilities

- Create delivery folders
- Copy files
- Share content with customer
- Return fulfillment status

### Platform Responsibilities

- Send fulfillment requests
- Receive fulfillment results
- Record fulfillment history
- Display fulfillment status in administration screens

The platform does not directly manage Google Drive resources.

# 13. Full Library Fulfillment

For Full Library purchases:

- The platform submits a fulfillment request of type "Full Library".
- The external service shares the predefined Master Library folder.
- No duplication of the 428 files occurs.

# 14. Fulfillment Tracking

For every successful fulfillment request, the platform shall record:

- Shared Email
- Share Date/Time
- Share Status
- Delivery Folder URL

This information must be visible within administration screens.

# 15. Content Retention

Delivered content remains available indefinitely.

The platform does not perform automatic deletion of customer delivery folders or shared content.

# 16. Email Notifications

## Customer Emails

- Purchase confirmation
- Order summary
- Delivery link
- Contact information

## Office Emails

- Successful purchases
- Failed payments
- Leads
- Gift Story requests
- Fulfillment failures
- System errors

Retry logic shall be implemented for email failures.

# 17. Gift Story Flow

Users may request a free gift story.

Process:

- User enters contact details.
- Email is required.
- No payment is required.
- A predefined gift story is sent automatically.
- Lead record is created.

Purpose:

- Lead generation
- Future customer conversion

# 18. Administration Dashboard

## KPI Cards

- Orders Today
- Requires Attention
- Failed Payments
- Leads Only
- Paid Credit Orders
- Monthly Revenue
- USB Orders
- System Errors

## Orders Table

Key columns:

- Order ID
- Creation Date
- Customer Name
- Email
- Phone
- Order Amount
- Payment Type
- Payment Status
- Processing Status
- Delivery Type
- Fulfillment Status
- Delivery Folder URL
- Office Notes

# 19. Assumptions

- Google Apps Script fulfillment service is maintained externally.
- Gmail is used for email delivery.
- Google Sheets is the source of catalog and pricing data.
- File IDs are managed manually.

# 20. Risks

- Dependency on Google services.
- Fulfillment service availability.
- Invalid catalog data.
- Third-party integration failures.
- Email delivery failures.

# 21. Open Questions

- Story search functionality
- Auto-save customer selections
- Email resend functionality
- Editing existing orders
- Bank transfer reminders
- Password reset flow
- Backup strategy
- Pagination strategy

# 22. Roadmap

## Phase 1 – MVP

- Story purchasing
- Payments
- External fulfillment
- Email notifications
- Lead generation
- Administration dashboard

## Phase 2

- Story search
- Email resend actions
- Advanced order management
- Payment reminder automation

## Phase 3

- CRM capabilities
- Analytics and reporting
- Marketing automation
- Customer history management

# Status

Approved for Architecture Design and Development Planning.
