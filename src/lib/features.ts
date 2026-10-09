/**
 * Feature switches for parts of the app that are built but switched off in the UI.
 *
 * INCOMING_DOCUMENTS_ENABLED: the Incoming Documents inbox (email RFQ/PR/PO).
 * While false, the sidebar link is hidden and /incoming-documents opens the
 * dashboard. Nothing behind it is removed: the table, actions, the inbound
 * email endpoint (/api/inbound-email), the convert-to-Query / Sales Order flow
 * and the backups keep working. Set it to true to bring the screen back.
 */
export const INCOMING_DOCUMENTS_ENABLED = false;
