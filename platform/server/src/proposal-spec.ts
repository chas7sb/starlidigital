export type ProposalMode = 'snapshot' | 'bespoke';

export type VerticalType =
  | 'auto-service'
  | 'beauty'
  | 'clinic'
  | 'construction'
  | 'trades'
  | 'cleaning'
  | 'hospitality'
  | 'restaurant'
  | 'furniture'
  | 'events'
  | 'professional';

export type LeadScore = 'cold' | 'viewed' | 'engaged' | 'high_intent' | 'claimed';

export type ProposalSpec = {
  proposalId: string;
  leadId: string;
  generationMode: ProposalMode;

  business: {
    name: string;
    category: string;
    subcategory?: string;
    city?: string;
    serviceArea?: string;
    phone?: string;
    email?: string;
    address?: string;
    openingHours?: string;
    existingWebsite?: string;
    socialProfiles?: Record<string, string>;
  };

  content: {
    headline: string;
    subheadline: string;
    description: string;
    services: Array<{ title: string; description: string; price?: string; icon?: string }>;
    differentiators: string[];
    about: string;
    faq?: Array<{ question: string; answer: string }>;
    confirmedTestimonials?: Array<{ author: string; text: string; role?: string }>;
    confirmedPrices?: Array<{ item: string; price: string }>;
  };

  branding: {
    logoText: string;
    primaryColor: string;
    accentColor: string;
    bgColor: string;
    surfaceColor: string;
    textColor: string;
    visualMood: 'premium-dark' | 'clean-light' | 'editorial-neutral' | 'luxury-dark' | 'architectural' | 'fresh-bright' | 'cinematic';
    typographyDirection: 'sans-modern' | 'serif-editorial' | 'industrial-mono';
  };

  media: {
    heroImage?: string;
    galleryImages: string[];
    beforeAfter?: { before: string; after: string; label: string };
  };

  template: {
    vertical: VerticalType;
    variant: string;
    version: string;
    sectionOrder: string[];
    enabledSections: Record<string, boolean>;
  };

  conversion: {
    primaryAction: { label: string; url: string; kind: 'call' | 'whatsapp' | 'booking' | 'quote' };
    secondaryAction?: { label: string; url: string };
    whatsapp?: string;
    phone?: string;
    formTitle?: string;
  };

  research: {
    sources: Array<{ title: string; url: string }>;
    confirmedFacts: string[];
    unknownFacts: string[];
  };

  opportunity: {
    detectedProblem: string;
    recommendedSolution: string;
    explanation: string;
  };

  costAccounting: {
    researchAiUnits: number;
    specAiUnits: number;
    imageAiUnits: number;
    builderAiUnits: number;
    buildUnits: number;
    totalCostUnits: number;
  };

  metadata: {
    generatedAt: string;
    generationVersion: string;
  };
};

export const VERTICAL_DEFINITIONS: Record<
  VerticalType,
  {
    nameRo: string;
    subcategories: string[];
    defaultVariants: string[];
    primaryConversion: 'call' | 'whatsapp' | 'booking' | 'quote';
  }
> = {
  'auto-service': {
    nameRo: 'Service Auto / Detailing',
    subcategories: ['service auto', 'detailing', 'vulcanizare', 'spălătorie auto', 'colantări', 'PPF', 'ceramică'],
    defaultVariants: ['premium-dark', 'clean-light', 'performance'],
    primaryConversion: 'whatsapp'
  },
  beauty: {
    nameRo: 'Salon / Beauty / Barber',
    subcategories: ['salon înfrumusețare', 'frizerie', 'barber', 'manichiură', 'cosmetică', 'spa', 'gene'],
    defaultVariants: ['editorial-neutral', 'luxury-dark', 'soft-modern'],
    primaryConversion: 'booking'
  },
  clinic: {
    nameRo: 'Clinică / Stomatologie / Medical',
    subcategories: ['stomatologie', 'clinică dentară', 'estetică', 'dermatologie', 'cabinet medical'],
    defaultVariants: ['clean-light', 'modern-clinical', 'high-trust'],
    primaryConversion: 'booking'
  },
  construction: {
    nameRo: 'Construcții / Amenajări',
    subcategories: ['construcții', 'renovări', 'amenajări interioare', 'acoperișuri', 'fațade', 'antreprenor'],
    defaultVariants: ['architectural', 'industrial', 'premium-minimal'],
    primaryConversion: 'quote'
  },
  trades: {
    nameRo: 'Instalații / Electricieni / HVAC',
    subcategories: ['electrician', 'instalator', 'climatizare', 'încălzire', 'centrale termice', 'urgențe'],
    defaultVariants: ['high-contrast-fast', 'clean-functional'],
    primaryConversion: 'call'
  },
  cleaning: {
    nameRo: 'Curățenie / Servicii Profesionale',
    subcategories: ['curățenie birouri', 'curățenie locuințe', 'curățenie după constructor', 'curățenie airbnb'],
    defaultVariants: ['fresh-bright', 'corporate-clean'],
    primaryConversion: 'quote'
  },
  hospitality: {
    nameRo: 'Pensiune / Vilă / Hotel Boutique',
    subcategories: ['pensiune', 'vilă', 'hotel boutique', 'cabane', 'cazare'],
    defaultVariants: ['editorial-warm', 'nature-retreat', 'luxury-minimal'],
    primaryConversion: 'booking'
  },
  restaurant: {
    nameRo: 'Restaurant / Cafenea / Bistro',
    subcategories: ['restaurant', 'cafenea', 'bistro', 'brutărie', 'cofetărie', 'food truck'],
    defaultVariants: ['atmospheric-dark', 'artisan-light'],
    primaryConversion: 'whatsapp'
  },
  furniture: {
    nameRo: 'Mobilă la Comandă / Tâmplărie',
    subcategories: ['mobilă bucătărie', 'mobilă la comandă', 'dressinguri', 'tâmplărie lemn', 'design interior'],
    defaultVariants: ['architectural-editorial', 'nordic-minimal'],
    primaryConversion: 'quote'
  },
  events: {
    nameRo: 'Foto-Video / Evenimente / Nunți',
    subcategories: ['fotograf nuntă', 'videograf', 'organizare evenimente', 'decor nunți', 'DJ evenimente'],
    defaultVariants: ['cinematic-dark', 'editorial-elegance'],
    primaryConversion: 'quote'
  },
  professional: {
    nameRo: 'Servicii profesionale',
    subcategories: ['servicii locale', 'consultanță', 'servicii pentru companii'],
    defaultVariants: ['clean-light', 'editorial-neutral'],
    primaryConversion: 'quote'
  }
};
