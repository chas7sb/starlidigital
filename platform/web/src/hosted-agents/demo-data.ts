import type { HostedAgentPublic } from './types.ts';

export const STOMA_SAN_DEMO_AGENT: HostedAgentPublic = {
  publicId: 'demo-stoma-san',
  slug: 'stoma-san',
  name: 'Stoma San AI Receptionist',
  businessName: 'Stoma San',
  type: 'BOOKING',
  status: 'DEMO',
  welcomeMessage:
    'Bună! Sunt recepționerul AI pentru Stoma San.\nTe pot ajuta cu informații despre servicii, programări, prețuri sau pregătirea pentru un tratament.\n\nCu ce te pot ajuta astăzi?',
  appearanceJson: JSON.stringify({
    title: 'Stoma San AI Receptionist',
    subtitle: 'Unofficial Example by StarliDigital',
    primaryColor: '#58c0fc',
    quickPrompts: ['Programare', 'Servicii', 'Informații', 'Prețuri'],
    placeholderText: 'Scrie un mesaj...'
  })
};
