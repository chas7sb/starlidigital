import type { ConnectorProviderMetadata } from './types.js';

const oauth = (id: string, displayName: string, category: ConnectorProviderMetadata['category'], description: string, scopes: string[]): ConnectorProviderMetadata => ({
  id, displayName, category, description, authMode: 'OAUTH2', implementationStatus: 'METADATA_ONLY', liveAuthAvailable: false,
  supportedScopes: scopes, requiredConfiguration: ['provider client credentials', 'redirect URI registration']
});
const api = (id: string, displayName: string, category: ConnectorProviderMetadata['category'], description: string, scopes: string[]): ConnectorProviderMetadata => ({
  id, displayName, category, description, authMode: 'API_KEY', implementationStatus: 'METADATA_ONLY', liveAuthAvailable: false,
  supportedScopes: scopes, requiredConfiguration: ['provider credential broker']
});

export const CUSTOMER_CONNECTOR_PROVIDER_CATALOG: readonly ConnectorProviderMetadata[] = Object.freeze([
  oauth('gmail', 'Gmail', 'MAIL', 'Customer-owned Gmail mailbox connector metadata.', ['mail.read', 'mail.draft', 'mail.send']),
  oauth('outlook', 'Outlook', 'MAIL', 'Customer-owned Microsoft Outlook mailbox connector metadata.', ['mail.read', 'mail.draft', 'mail.send']),
  oauth('google-calendar', 'Google Calendar', 'CALENDAR', 'Customer Google Calendar connector metadata.', ['calendar.read', 'calendar.write']),
  oauth('google-drive', 'Google Drive', 'FILES', 'Customer Google Drive file connector metadata.', ['files.read', 'files.write']),
  oauth('dropbox', 'Dropbox', 'FILES', 'Customer Dropbox file connector metadata.', ['files.read', 'files.write']),
  oauth('onedrive', 'OneDrive', 'FILES', 'Customer Microsoft OneDrive file connector metadata.', ['files.read', 'files.write']),
  oauth('hubspot', 'HubSpot', 'CRM', 'Customer HubSpot CRM connector metadata.', ['crm.read', 'crm.write']),
  oauth('pipedrive', 'Pipedrive', 'CRM', 'Customer Pipedrive CRM connector metadata.', ['crm.read', 'crm.write']),
  oauth('salesforce', 'Salesforce', 'CRM', 'Customer Salesforce CRM connector metadata.', ['crm.read', 'crm.write']),
  oauth('shopify', 'Shopify', 'COMMERCE', 'Customer Shopify commerce connector metadata.', ['commerce.read', 'commerce.write']),
  api('woocommerce', 'WooCommerce', 'COMMERCE', 'Customer WooCommerce commerce connector metadata.', ['commerce.read', 'commerce.write']),
  api('stripe', 'Stripe', 'COMMERCE', 'Customer Stripe commerce and payment connector metadata.', ['commerce.read', 'payments.write']),
  oauth('github', 'GitHub', 'DEVELOPER', 'Customer GitHub repository connector metadata.', ['code.read', 'code.write', 'deploy.read']),
  oauth('gitlab', 'GitLab', 'DEVELOPER', 'Customer GitLab repository connector metadata.', ['code.read', 'code.write', 'deploy.read']),
  api('vercel', 'Vercel', 'DEVELOPER', 'Customer Vercel deployment connector metadata.', ['deploy.read', 'deploy.write']),
  api('cloudflare', 'Cloudflare', 'DEVELOPER', 'Customer Cloudflare DNS/deployment connector metadata.', ['dns.read', 'dns.write', 'deploy.read'])
]);
