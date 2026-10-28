import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts, PDFName, PDFString } from 'pdf-lib';

export interface BrokerEntry {
  id: string;
  name: string;
  displayLabel: string;
  couponCode: string;
  isDirect: boolean;
}

export interface GeneratedLinkEntry {
  id: string;
  brokerId: string;
  brokerName: string;
  employerName: string;
  refCode: string;
  couponCode: string;
  url: string;
  createdAt: string;
}

export interface DamienConfig {
  version: number;
  seedVersion?: number;
  ceName: string;
  state: string;
  baseUrl: string;
  updatedAt: string;
  adminUsername?: string;
  adminPassword?: string;
  brokers: BrokerEntry[];
  generatedLinks: GeneratedLinkEntry[];
}

const DAMIEN_CONSTANTS = {
  ceName: 'Damien Center',
  state: 'Indiana',
  baseUrl: 'https://app.helloalpha.com/damien-health',
  defaultAdminUsername: 'DamienAdmin',
  defaultAdminPassword: process.env.ADMIN_PASSWORD || 'indy123',
  allowedResetDomain: '@damien.org',
};

export function formatPascalToken(input: string): string {
  if (!input || !input.trim()) return '';
  const trimmed = input.trim();
  // Preserve exact casing if already a single alphanumeric token (e.g. damienpatient, BMcE, CityofIndianapolis, IMCU)
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed
    .replace(/['’]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function formatBusinessInitials(input: string): string {
  if (!input || !input.trim()) return '';
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed;
  }
  const words = trimmed
    .replace(/['’]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (words.length <= 1) {
    return formatPascalToken(trimmed);
  }
  return words
    .map((w) => {
      if (/^Mc[A-Z]/.test(w)) {
        return 'Mc';
      }
      const caps = w.slice(1).replace(/[^A-Z]/g, '');
      if (caps.length > 0) {
        return w.charAt(0).toUpperCase() + caps;
      }
      return w.charAt(0).toUpperCase();
    })
    .join('');
}

const KNOWN_BUSINESS_LOOKUP: Record<
  string,
  { refCode: string; couponOverride?: string; canonicalName?: string }
> = {
  // LHD & DC Generic
  'example template': {
    refCode: 'LHD',
    couponOverride: 'helloalphatestuser',
    canonicalName: 'Example Template',
  },
  'dc generic': {
    refCode: 'DCGeneral',
    couponOverride: 'firstmonthDCGeneral',
    canonicalName: 'DC Generic',
  },
  'dcgeneral': {
    refCode: 'DCGeneral',
    couponOverride: 'firstmonthDCGeneral',
    canonicalName: 'DC Generic',
  },
  'bose mckinney &evans': { refCode: 'BMcE', canonicalName: 'Bose McKinney & Evans' },
  'bose mckinney & evans': { refCode: 'BMcE', canonicalName: 'Bose McKinney & Evans' },
  'bose mckinney and evans': { refCode: 'BMcE', canonicalName: 'Bose McKinney & Evans' },
  'bmce': { refCode: 'BMcE', canonicalName: 'Bose McKinney & Evans' },
  'locascio hadden & dennis': { refCode: 'LCHD', canonicalName: 'LoCascio Hadden & Dennis' },
  'locascio hadden and dennis': { refCode: 'LCHD', canonicalName: 'LoCascio Hadden & Dennis' },
  'lchd': { refCode: 'LCHD', canonicalName: 'LoCascio Hadden & Dennis' },
  'indiana soybean alliance': { refCode: 'ISA', canonicalName: 'Indiana Soybean Alliance' },
  'isa': { refCode: 'ISA', canonicalName: 'Indiana Soybean Alliance' },
  'indiana members credit union': { refCode: 'IMCU', canonicalName: 'Indiana Members Credit Union' },
  'imcu': { refCode: 'IMCU', canonicalName: 'Indiana Members Credit Union' },
  'goshen community schools': { refCode: 'GCS', canonicalName: 'Goshen Community Schools' },
  'gcs': { refCode: 'GCS', canonicalName: 'Goshen Community Schools' },

  // Epic Insurance Brokers (26 Businesses)
  'acuity group operations': { refCode: 'EpicAcuity', canonicalName: 'Acuity Group Operations' },
  'epicacuity': { refCode: 'EpicAcuity', canonicalName: 'Acuity Group Operations' },
  'adaptek systems llc': { refCode: 'EpicAdaptecSystems', canonicalName: 'Adaptek Systems LLC' },
  'epicadaptecsystems': { refCode: 'EpicAdaptecSystems', canonicalName: 'Adaptek Systems LLC' },
  'allied physicians surgery center': { refCode: 'EpicAlliedPhysiciansSC', canonicalName: 'Allied Physicians Surgery Center' },
  'epicalliedphysicianssc': { refCode: 'EpicAlliedPhysiciansSC', canonicalName: 'Allied Physicians Surgery Center' },
  'benton county': { refCode: 'EpicBentonCounty', canonicalName: 'Benton County' },
  'epicbentoncounty': { refCode: 'EpicBentonCounty', canonicalName: 'Benton County' },
  'c&t design': { refCode: 'EpicCnT', canonicalName: 'C&T Design' },
  'epiccnt': { refCode: 'EpicCnT', canonicalName: 'C&T Design' },
  'cvr indy': { refCode: 'EpicCVR', canonicalName: 'CVR Indy' },
  'epiccvr': { refCode: 'EpicCVR', canonicalName: 'CVR Indy' },
  'deufol': { refCode: 'EpicDeufol', canonicalName: 'Deufol' },
  'epicdeufol': { refCode: 'EpicDeufol', canonicalName: 'Deufol' },
  'epic employees': { refCode: 'EpicEmployees', canonicalName: 'Epic Employees' },
  'epicemployees': { refCode: 'EpicEmployees', canonicalName: 'Epic Employees' },
  'first presbyterian ft wayne': { refCode: 'EpicFirstPresFW', canonicalName: 'First Presbyterian Ft Wayne' },
  'epicfirstpresfw': { refCode: 'EpicFirstPresFW', canonicalName: 'First Presbyterian Ft Wayne' },
  'healthcare therapy services': { refCode: 'EpicHTSIndiana', canonicalName: 'Healthcare Therapy Services' },
  'epichtsindiana': { refCode: 'EpicHTSIndiana', canonicalName: 'Healthcare Therapy Services' },
  'honey creek fire & rescue': { refCode: 'EpicHCFNR', canonicalName: 'Honey Creek Fire & Rescue' },
  'epichcfnr': { refCode: 'EpicHCFNR', canonicalName: 'Honey Creek Fire & Rescue' },
  'jdh infrastructure group': { refCode: 'EpicJDH', canonicalName: 'JDH Infrastructure Group' },
  'epicjdh': { refCode: 'EpicJDH', canonicalName: 'JDH Infrastructure Group' },
  'jensen cabinet': { refCode: 'EpicJensenCabinet', canonicalName: 'Jensen Cabinet' },
  'epicjensencabinet': { refCode: 'EpicJensenCabinet', canonicalName: 'Jensen Cabinet' },
  'league for the blind and disabled': { refCode: 'EpicLEAGUE', canonicalName: 'League for the Blind and Disabled' },
  'epicleague': { refCode: 'EpicLEAGUE', canonicalName: 'League for the Blind and Disabled' },
  'northern lights': { refCode: 'EpicNorthernLights', canonicalName: 'Northern Lights' },
  'epicnorthernlights': { refCode: 'EpicNorthernLights', canonicalName: 'Northern Lights' },
  'peabody retirement community': { refCode: 'EpicPeabody', canonicalName: 'Peabody Retirement Community' },
  'epicpeabody': { refCode: 'EpicPeabody', canonicalName: 'Peabody Retirement Community' },
  'putnam county': { refCode: 'EpicPutnam', canonicalName: 'Putnam County' },
  'epicputnam': { refCode: 'EpicPutnam', canonicalName: 'Putnam County' },
  'smith brothers of berne inc': { refCode: 'EpicSmithBrothers', canonicalName: 'Smith Brothers of Berne Inc' },
  'epicsmithbrothers': { refCode: 'EpicSmithBrothers', canonicalName: 'Smith Brothers of Berne Inc' },
  'epicsmithbros': { refCode: 'EpicSmithBros', canonicalName: 'Smith Brothers of Berne Inc' },
  'state bank': { refCode: 'EpicStateBank', canonicalName: 'State Bank' },
  'epicstatebank': { refCode: 'EpicStateBank', canonicalName: 'State Bank' },
  'nvb playground': { refCode: 'EpicNVBPlayground', canonicalName: 'NVB Playground' },
  'epicnvbplayground': { refCode: 'EpicNVBPlayground', canonicalName: 'NVB Playground' },
  'facadetek': { refCode: 'EpicFacadeTek', canonicalName: 'FacadeTek' },
  'epicfacadetek': { refCode: 'EpicFacadeTek', canonicalName: 'FacadeTek' },
  'api alliance': { refCode: 'EpicAPIAlliance', canonicalName: 'API Alliance' },
  'epicapialliance': { refCode: 'EpicAPIAlliance', canonicalName: 'API Alliance' },
  'gillette generators llc': { refCode: 'EpicGGL', canonicalName: 'Gillette Generators LLC' },
  'epicggl': { refCode: 'EpicGGL', canonicalName: 'Gillette Generators LLC' },
  'the city of terre haute': { refCode: 'EpicTerreHaute', canonicalName: 'The City of Terre Haute' },
  'terre haute': { refCode: 'EpicTerreHaute', canonicalName: 'The City of Terre Haute' },
  'epicterrehaute': { refCode: 'EpicTerreHaute', canonicalName: 'The City of Terre Haute' },
  'wabash valley health': { refCode: 'EpicWVHC', canonicalName: 'Wabash Valley Health' },
  'epicwvhc': { refCode: 'EpicWVHC', canonicalName: 'Wabash Valley Health' },
  'adams remco': { refCode: 'EpicAdams', canonicalName: 'Adams Remco' },
  'epicadams': { refCode: 'EpicAdams', canonicalName: 'Adams Remco' },

  // Damien Center Direct Employers (17 Businesses)
  'martin farms': { refCode: 'MartinFF', canonicalName: 'Martin Farms' },
  'martinff': { refCode: 'MartinFF', canonicalName: 'Martin Farms' },
  'ihsaa': { refCode: 'IHSAA', canonicalName: 'IHSAA' },
  'drg': { refCode: 'DRG', canonicalName: 'DRG' },
  'pcsc': { refCode: 'PCSC', canonicalName: 'PCSC' },
  'jwsc': { refCode: 'JWSC', canonicalName: 'JWSC' },
  'evsc': { refCode: 'EVSC', canonicalName: 'EVSC' },
  'harsha behavioral health': { refCode: 'HBH', canonicalName: 'Harsha Behavioral Health' },
  'hbh': { refCode: 'HBH', canonicalName: 'Harsha Behavioral Health' },
  'city of lawrence': { refCode: 'CoL', canonicalName: 'City of Lawrence' },
  'col': { refCode: 'CoL', canonicalName: 'City of Lawrence' },
  'assurance health': { refCode: 'AHC', canonicalName: 'Assurance Health' },
  'ahc': { refCode: 'AHC', canonicalName: 'Assurance Health' },
  'granite management': { refCode: 'Granite', canonicalName: 'Granite Management' },
  'granite': { refCode: 'Granite', canonicalName: 'Granite Management' },
  'warrick county': { refCode: 'WC', canonicalName: 'Warrick County' },
  'wc': { refCode: 'WC', canonicalName: 'Warrick County' },
  'city of evansville': { refCode: 'CoE', canonicalName: 'City of Evansville' },
  'coe': { refCode: 'CoE', canonicalName: 'City of Evansville' },
  'hamilton center': { refCode: 'HCtr', canonicalName: 'Hamilton Center' },
  'hctr': { refCode: 'HCtr', canonicalName: 'Hamilton Center' },
  'toa usa': { refCode: 'TOAU', canonicalName: 'TOA USA' },
  'toau': { refCode: 'TOAU', canonicalName: 'TOA USA' },
  'toa winchester': { refCode: 'TOAW', canonicalName: 'TOA Winchester' },
  'toaw': { refCode: 'TOAW', canonicalName: 'TOA Winchester' },
  'khorporate': { refCode: 'Khor', canonicalName: 'Khorporate' },
  'khor': { refCode: 'Khor', canonicalName: 'Khorporate' },
  'printing partners': { refCode: 'PPart', canonicalName: 'Printing Partners' },
  'ppart': { refCode: 'PPart', canonicalName: 'Printing Partners' },

  // NFP (5 Businesses)
  'example template (nfp)': { refCode: 'NFP', canonicalName: 'Example Template (NFP)' },
  'nfp': { refCode: 'NFP', canonicalName: 'Example Template (NFP)' },
  'resultant': { refCode: 'Res', canonicalName: 'Resultant' },
  'res': { refCode: 'Res', canonicalName: 'Resultant' },
  'firefly': { refCode: 'FFLY', canonicalName: 'Firefly' },
  'ffly': { refCode: 'FFLY', canonicalName: 'Firefly' },
  'godfrey marine': { refCode: 'GMar', canonicalName: 'Godfrey Marine' },
  'gmar': { refCode: 'GMar', canonicalName: 'Godfrey Marine' },
  'bennington': { refCode: 'Benn', canonicalName: 'Bennington' },
  'benn': { refCode: 'Benn', canonicalName: 'Bennington' },

  // Conner Insurance (3 Businesses)
  'example template (conner)': { refCode: 'Conner', canonicalName: 'Example Template (Conner)' },
  'conner': { refCode: 'Conner', canonicalName: 'Example Template (Conner)' },
  'zionsville': { refCode: 'ZionsvilleConner', canonicalName: 'Zionsville' },
  'zionsvilleconner': { refCode: 'ZionsvilleConner', canonicalName: 'Zionsville' },
  'plainfield': { refCode: 'TOPConner', canonicalName: 'Plainfield' },
  'topconner': { refCode: 'TOPConner', canonicalName: 'Plainfield' },

  // Damien Center Direct / Special Programs & Associations (11 Entries)
  'damien center employees': {
    refCode: 'damienpatient',
    couponOverride: 'damienemployee',
    canonicalName: 'Damien Center Employees',
  },
  'damien employees': {
    refCode: 'damienpatient',
    couponOverride: 'damienemployee',
    canonicalName: 'Damien Center Employees',
  },
  'damienemployee': {
    refCode: 'damienpatient',
    couponOverride: 'damienemployee',
    canonicalName: 'Damien Center Employees',
  },
  'damien center (direct)': {
    refCode: 'damienpatient',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct)',
  },
  'damien center direct': {
    refCode: 'damienpatient',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct)',
  },
  'damienpatient': {
    refCode: 'damienpatient',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct)',
  },
  'damien center (direct) meta': {
    refCode: 'damienpatientorganic1',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 1',
  },
  'damien center (direct) meta 1': {
    refCode: 'damienpatientorganic1',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 1',
  },
  'damienpatientorganic1': {
    refCode: 'damienpatientorganic1',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 1',
  },
  'damien center (direct) meta 2': {
    refCode: 'damienpatientorganic2',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 2',
  },
  'damienpatientorganic2': {
    refCode: 'damienpatientorganic2',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 2',
  },
  'damien center (direct) meta 3': {
    refCode: 'damienpatientorganic3',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 3',
  },
  'damienpatientorganic3': {
    refCode: 'damienpatientorganic3',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 3',
  },
  'damien center (direct) meta 4': {
    refCode: 'damienpatientorganic4',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 4',
  },
  'damienpatientorganic4': {
    refCode: 'damienpatientorganic4',
    couponOverride: '',
    canonicalName: 'Damien Center (Direct) Meta 4',
  },
  'damien center friends and family': {
    refCode: 'damienpatient',
    couponOverride: 'damienfriend',
    canonicalName: 'Damien Center Friends and Family',
  },
  'damien center friends': {
    refCode: 'damienpatient',
    couponOverride: 'damienfriend',
    canonicalName: 'Damien Center Friends and Family',
  },
  'damienfriend': {
    refCode: 'damienpatient',
    couponOverride: 'damienfriend',
    canonicalName: 'Damien Center Friends and Family',
  },
  'damien center friends and family newsletter': {
    refCode: 'damienpatientnewsletter',
    couponOverride: 'damienfriend',
    canonicalName: 'Damien Center Friends and Family newsletter',
  },
  'damienpatientnewsletter': {
    refCode: 'damienpatientnewsletter',
    couponOverride: 'damienfriend',
    canonicalName: 'Damien Center Friends and Family newsletter',
  },
  'indy rainbow chamber': {
    refCode: '',
    couponOverride: 'IRCC',
    canonicalName: 'Indy Rainbow Chamber',
  },
  'ircc': {
    refCode: '',
    couponOverride: 'IRCC',
    canonicalName: 'Indy Rainbow Chamber',
  },
  'the cilty of indianapolis (coi)': {
    refCode: 'City of Indianapolis',
    couponOverride: 'firstmonthCoI',
    canonicalName: 'The City of Indianapolis (CoI)',
  },
  'the city of indianapolis (coi)': {
    refCode: 'City of Indianapolis',
    couponOverride: 'firstmonthCoI',
    canonicalName: 'The City of Indianapolis (CoI)',
  },
  'city of indianapolis': {
    refCode: 'City of Indianapolis',
    couponOverride: 'firstmonthCoI',
    canonicalName: 'The City of Indianapolis (CoI)',
  },
  'coi': {
    refCode: 'City of Indianapolis',
    couponOverride: 'firstmonthCoI',
    canonicalName: 'The City of Indianapolis (CoI)',
  },
  'the indiana credit union league (ilcu)': {
    refCode: 'ICUL',
    couponOverride: 'firstmonthICUL',
    canonicalName: 'The Indiana Credit Union League (ILCU)',
  },
  'the indiana credit union league (icul)': {
    refCode: 'ICUL',
    couponOverride: 'firstmonthICUL',
    canonicalName: 'The Indiana Credit Union League (ILCU)',
  },
  'indiana credit union league': {
    refCode: 'ICUL',
    couponOverride: 'firstmonthICUL',
    canonicalName: 'The Indiana Credit Union League (ILCU)',
  },
  'icul': {
    refCode: 'ICUL',
    couponOverride: 'firstmonthICUL',
    canonicalName: 'The Indiana Credit Union League (ILCU)',
  },
  'ilcu': {
    refCode: 'ICUL',
    couponOverride: 'firstmonthICUL',
    canonicalName: 'The Indiana Credit Union League (ILCU)',
  },
};

export function formatSlug(input: string): string {
  if (!input || !input.trim()) return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildDamienEmployerUrl(
  brokerId: string,
  brokerName: string,
  employerName: string,
  couponCode: string,
  isDirect = false,
  customRefCode?: string
): { url: string; refCode: string; couponCode: string; displayEmployerName: string } {
  const rawEmployer = String(employerName || '').trim();
  const normalizedKey = rawEmployer.toLowerCase().replace(/\s+/g, ' ');
  const lowerId = String(brokerId || '').trim().toLowerCase();
  const known =
    normalizedKey === 'example template' && lowerId === 'nfp'
      ? { refCode: 'NFP', canonicalName: 'Example Template (NFP)' }
      : normalizedKey === 'example template' && lowerId === 'conner'
      ? { refCode: 'Conner', canonicalName: 'Example Template (Conner)' }
      : KNOWN_BUSINESS_LOOKUP[normalizedKey];

  const cleanEmployer = formatPascalToken(rawEmployer);
  let refCode = cleanEmployer;

  if (customRefCode && String(customRefCode).trim()) {
    refCode = formatPascalToken(String(customRefCode).trim());
  } else if (known) {
    refCode = known.refCode;
  } else if (lowerId === 'epic') {
    refCode = cleanEmployer.toLowerCase().startsWith('epic')
      ? cleanEmployer
      : `Epic${cleanEmployer}`;
  } else if (lowerId === 'conner') {
    refCode = cleanEmployer.toLowerCase().endsWith('conner')
      ? cleanEmployer
      : `${cleanEmployer}Conner`;
  } else if (lowerId === 'lhd') {
    refCode = formatBusinessInitials(rawEmployer);
  } else if (
    isDirect ||
    ['damien', 'nfp', 'mgb', 'coi', 'damienemployee', 'damienfriend', 'ircc'].includes(lowerId)
  ) {
    refCode = cleanEmployer;
  } else {
    const cleanBroker = formatPascalToken(brokerName);
    refCode = cleanEmployer.toLowerCase().startsWith(cleanBroker.toLowerCase())
      ? cleanEmployer
      : `${cleanBroker}${cleanEmployer}`;
  }

  const hasCouponOverride = Boolean(
    known && Object.prototype.hasOwnProperty.call(known, 'couponOverride')
  );
  const cleanCoupon = String(
    hasCouponOverride ? known!.couponOverride || '' : couponCode || ''
  ).trim();
  const displayEmployerName = known?.canonicalName || rawEmployer;

  let url = DAMIEN_CONSTANTS.baseUrl;
  if (refCode && cleanCoupon) {
    url += `?ref=${encodeURIComponent(refCode)}&coupon=${encodeURIComponent(cleanCoupon)}`;
  } else if (refCode) {
    url += `?ref=${encodeURIComponent(refCode)}`;
  } else if (cleanCoupon) {
    url += `?coupon=${encodeURIComponent(cleanCoupon)}`;
  }

  return { url, refCode, couponCode: cleanCoupon, displayEmployerName };
}

const SEED_PATH = path.resolve(__dirname, '../data/damien-config.json');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const CONFIG_FILE_PATH = path.join(DATA_DIR, 'damien-config.json');

function ensureDirectBroker(config: DamienConfig): DamienConfig {
  config.ceName = DAMIEN_CONSTANTS.ceName;
  config.state = DAMIEN_CONSTANTS.state;
  config.baseUrl = DAMIEN_CONSTANTS.baseUrl;
  if (!Array.isArray(config.brokers)) {
    config.brokers = [];
  }
  if (!Array.isArray(config.generatedLinks)) {
    config.generatedLinks = [];
  }

  const existingDirectIdx = config.brokers.findIndex(
    (b) => b.id === 'damien' || b.isDirect
  );
  if (existingDirectIdx === -1) {
    config.brokers.unshift({
      id: 'damien',
      name: 'Damien Center',
      displayLabel: 'Damien Center (Direct — No Broker)',
      couponCode: 'firstmonth',
      isDirect: true,
    });
  } else {
    const direct = config.brokers[existingDirectIdx];
    direct.id = 'damien';
    direct.name = 'Damien Center';
    direct.displayLabel = 'Damien Center (Direct — No Broker)';
    direct.isDirect = true;
    if (existingDirectIdx > 0) {
      config.brokers.splice(existingDirectIdx, 1);
      config.brokers.unshift(direct);
    }
  }
  return config;
}

function loadConfig(): DamienConfig {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE_PATH)) {
    if (fs.existsSync(SEED_PATH)) {
      fs.copyFileSync(SEED_PATH, CONFIG_FILE_PATH);
    } else {
      const initial: DamienConfig = ensureDirectBroker({
        version: 1,
        seedVersion: 8,
        ceName: DAMIEN_CONSTANTS.ceName,
        state: DAMIEN_CONSTANTS.state,
        baseUrl: DAMIEN_CONSTANTS.baseUrl,
        updatedAt: new Date().toISOString(),
        brokers: [],
        generatedLinks: [],
      });
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    }
  }
  let raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
  let parsed = JSON.parse(raw) as DamienConfig;
  if (
    SEED_PATH !== CONFIG_FILE_PATH &&
    (!parsed.seedVersion || parsed.seedVersion < 8) &&
    fs.existsSync(SEED_PATH)
  ) {
    fs.copyFileSync(SEED_PATH, CONFIG_FILE_PATH);
    raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    parsed = JSON.parse(raw) as DamienConfig;
  }
  return ensureDirectBroker(parsed);
}

function saveConfig(config: DamienConfig): DamienConfig {
  ensureDirectBroker(config);
  config.version = (config.version || 1) + 1;
  config.updatedAt = new Date().toISOString();
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

function getExpectedAdminToken(config: DamienConfig): string {
  const pwd = config.adminPassword || DAMIEN_CONSTANTS.defaultAdminPassword;
  return Buffer.from(`DamienAdmin:${pwd}`).toString('base64');
}

function isAdminAuthenticated(req: Request, config: DamienConfig): boolean {
  const headerToken = String(req.headers['x-admin-token'] || '').trim();
  if (!headerToken) return false;
  return headerToken === getExpectedAdminToken(config);
}

export async function createServer() {
  let stateConfig = loadConfig();

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // 0A. Admin Login (id: DamienAdmin / DamienAdmn, default pwd: indy123)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    stateConfig = loadConfig();
    const rawUser = String(req.body?.username || '').trim().toLowerCase();
    const rawPass = String(req.body?.password || '');
    const activePass = stateConfig.adminPassword || DAMIEN_CONSTANTS.defaultAdminPassword;

    const validUser = rawUser === 'damienadmin' || rawUser === 'damienadmn';
    if (!validUser || rawPass !== activePass) {
      res.status(401).json({ error: 'Invalid Admin ID or Password.' });
      return;
    }

    res.json({
      ok: true,
      username: 'DamienAdmin',
      token: getExpectedAdminToken(stateConfig),
    });
  });

  // 0B. Self-Service Admin Password Reset via any @damien.org email
  app.post('/api/auth/reset-password', (req: Request, res: Response) => {
    stateConfig = loadConfig();
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || '').trim();

    const emailRegex = /^[a-z0-9._%+-]+@damien\.org$/i;
    if (!emailRegex.test(rawEmail)) {
      res.status(400).json({
        error: 'Please enter an authorized Damien Center email address to reset the password.',
      });
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      res.status(400).json({
        error: 'New password must be at least 4 characters.',
      });
      return;
    }

    stateConfig.adminUsername = 'DamienAdmin';
    stateConfig.adminPassword = newPassword;
    saveConfig(stateConfig);

    res.json({
      ok: true,
      username: 'DamienAdmin',
      email: rawEmail,
      token: getExpectedAdminToken(stateConfig),
    });
  });

  // 1. Bootstrap endpoint (Scoped server-side for ?broker=<id>, or requires Admin login for full view)
  app.get('/api/bootstrap', (req: Request, res: Response) => {
    stateConfig = loadConfig();
    const brokerQuery = String(req.query.broker || '').trim().toLowerCase();

    if (brokerQuery) {
      const matchedBroker = stateConfig.brokers.find(
        (b) => b.id.toLowerCase() === brokerQuery
      );
      const scopedLinks = stateConfig.generatedLinks.filter(
        (g) => g.brokerId.toLowerCase() === brokerQuery
      );
      res.json({
        requiresAuth: false,
        mode: 'BROKER',
        config: {
          version: stateConfig.version,
          ceName: stateConfig.ceName,
          state: stateConfig.state,
          baseUrl: stateConfig.baseUrl,
          updatedAt: stateConfig.updatedAt,
          brokers: matchedBroker ? [matchedBroker] : [],
          generatedLinks: scopedLinks,
        },
      });
      return;
    }

    if (!isAdminAuthenticated(req, stateConfig)) {
      res.json({
        requiresAuth: true,
        mode: 'ADMIN',
        config: null,
      });
      return;
    }

    const { adminPassword: _hidden, ...safeConfig } = stateConfig;
    res.json({
      requiresAuth: false,
      mode: 'ADMIN',
      config: safeConfig,
    });
  });

  // 2. Upsert Broker + Already-Created Coupon (Admin Only)
  app.post('/api/brokers/upsert', (req: Request, res: Response) => {
    try {
      stateConfig = loadConfig();
      if (!isAdminAuthenticated(req, stateConfig)) {
        res.status(401).json({ error: 'Admin sign-in is required to add or edit brokers.' });
        return;
      }
      const { id, name, couponCode } = req.body;

      const cleanCoupon = String(couponCode || '').trim();
      const targetId = id && String(id).trim() ? formatSlug(String(id)) : formatSlug(String(name || ''));

      if (targetId === 'damien') {
        const directBroker = stateConfig.brokers.find((b) => b.id === 'damien')!;
        directBroker.couponCode = cleanCoupon;
        saveConfig(stateConfig);
        res.json({
          broker: directBroker,
          brokers: stateConfig.brokers,
        });
        return;
      }

      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'Broker Name is required.' });
        return;
      }

      const cleanName = String(name).trim();
      const brokerId = targetId || formatSlug(cleanName);
      if (!brokerId) {
        res.status(400).json({ error: 'Valid Broker Name is required.' });
        return;
      }

      const existingIdx = stateConfig.brokers.findIndex(
        (b) => b.id.toLowerCase() === brokerId.toLowerCase()
      );

      const entry: BrokerEntry = {
        id: existingIdx >= 0 ? stateConfig.brokers[existingIdx].id : brokerId,
        name: cleanName,
        displayLabel: cleanName,
        couponCode: cleanCoupon,
        isDirect: false,
      };

      if (existingIdx >= 0) {
        stateConfig.brokers[existingIdx] = entry;
      } else {
        stateConfig.brokers.push(entry);
      }

      saveConfig(stateConfig);
      res.json({
        broker: entry,
        brokers: stateConfig.brokers,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to save broker.' });
    }
  });

  // 3. Delete Broker (Admin Only — protects built-in Damien Direct broker)
  app.post('/api/brokers/delete', (req: Request, res: Response) => {
    try {
      stateConfig = loadConfig();
      if (!isAdminAuthenticated(req, stateConfig)) {
        res.status(401).json({ error: 'Admin sign-in is required to delete brokers.' });
        return;
      }
      const { id } = req.body;
      if (!id) {
        res.status(400).json({ error: 'Broker ID is required.' });
        return;
      }
      if (String(id).toLowerCase() === 'damien') {
        res.status(400).json({
          error: 'The built-in Damien Center (Direct — No Broker) entry cannot be deleted.',
        });
        return;
      }

      stateConfig.brokers = stateConfig.brokers.filter(
        (b) => b.id.toLowerCase() !== String(id).toLowerCase()
      );
      stateConfig.generatedLinks = stateConfig.generatedLinks.filter(
        (g) => g.brokerId.toLowerCase() !== String(id).toLowerCase()
      );
      saveConfig(stateConfig);

      res.json({
        brokers: stateConfig.brokers,
        generatedLinks: stateConfig.generatedLinks,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete broker.' });
    }
  });

  // 4. Generate Employer Enrollment URL + QR Code
  app.post('/api/generate', async (req: Request, res: Response) => {
    try {
      const { brokerId, employerName } = req.body;
      if (!brokerId || !String(brokerId).trim()) {
        res.status(400).json({ error: 'Please select a Broker.' });
        return;
      }
      if (!employerName || !String(employerName).trim()) {
        res.status(400).json({ error: 'Please enter an Employer Name.' });
        return;
      }

      stateConfig = loadConfig();
      const broker = stateConfig.brokers.find(
        (b) => b.id.toLowerCase() === String(brokerId).trim().toLowerCase()
      );
      if (!broker) {
        res.status(404).json({ error: `Broker "${brokerId}" not found.` });
        return;
      }

      const cleanEmployer = String(employerName).trim();
      const customRefCode = req.body.customRefCode ? String(req.body.customRefCode).trim() : '';
      const { url, refCode, couponCode, displayEmployerName } = buildDamienEmployerUrl(
        broker.id,
        broker.name,
        cleanEmployer,
        broker.couponCode,
        broker.isDirect,
        customRefCode
      );

      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 420,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });

      const entryId = `${broker.id}__${formatSlug(displayEmployerName || refCode || couponCode)}`;
      const record: GeneratedLinkEntry = {
        id: entryId,
        brokerId: broker.id,
        brokerName: broker.name,
        employerName: displayEmployerName,
        refCode,
        couponCode,
        url,
        createdAt: new Date().toISOString(),
      };

      stateConfig.generatedLinks = stateConfig.generatedLinks.filter(
        (g) => g.id !== entryId && !(g.brokerId === broker.id && g.url === url && g.employerName === displayEmployerName)
      );
      stateConfig.generatedLinks.unshift(record);
      if (stateConfig.generatedLinks.length > 250) {
        stateConfig.generatedLinks = stateConfig.generatedLinks.slice(0, 250);
      }
      saveConfig(stateConfig);

      const qrDownloadUrl = `/api/qr.png?url=${encodeURIComponent(url)}&employer=${encodeURIComponent(
        displayEmployerName
      )}&broker=${encodeURIComponent(broker.name)}`;
      const pdfFlyerUrl = `/api/pdf?url=${encodeURIComponent(url)}&employer=${encodeURIComponent(
        displayEmployerName
      )}&ref=${encodeURIComponent(refCode)}&mode=flyer`;
      const pdfPacketUrl = `/api/pdf?url=${encodeURIComponent(url)}&employer=${encodeURIComponent(
        displayEmployerName
      )}&ref=${encodeURIComponent(refCode)}&mode=packet`;

      const isAdmin = isAdminAuthenticated(req, stateConfig);
      const visibleLinks = isAdmin
        ? stateConfig.generatedLinks
        : stateConfig.generatedLinks.filter(
            (g) => g.brokerId.toLowerCase() === broker.id.toLowerCase()
          );

      res.json({
        result: {
          ...record,
          ceName: DAMIEN_CONSTANTS.ceName,
          state: DAMIEN_CONSTANTS.state,
          qrDataUrl,
          qrDownloadUrl,
          pdfFlyerUrl,
          pdfPacketUrl,
        },
        generatedLinks: visibleLinks,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate employer link and QR code.' });
    }
  });

  // 5. High-Resolution Downloadable QR Code PNG
  app.get('/api/qr.png', async (req: Request, res: Response) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      if (!targetUrl) {
        res.status(400).json({ error: 'Missing url query parameter.' });
        return;
      }
      if (!targetUrl.startsWith(DAMIEN_CONSTANTS.baseUrl)) {
        res.status(400).json({ error: 'URL must start with https://app.helloalpha.com/damien-health' });
        return;
      }
      const employer = formatPascalToken(String(req.query.employer || 'Employer'));
      const broker = formatPascalToken(String(req.query.broker || 'DamienCenter'));
      const filename = `QR-DamienCenter-${broker}-${employer || 'Employer'}.png`;

      const pngBuffer = await QRCode.toBuffer(targetUrl, {
        type: 'png',
        width: 600,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pngBuffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to render QR PNG.' });
    }
  });

  // 6. Download Customized PDF Flyer (1-Page) or Full Packet (4-Page) with Employer URL & QR Code
  const PDF_TEMPLATE_PATH = path.resolve(
    __dirname,
    '../data/template-2027-dc-weight-management.pdf'
  );

  app.get('/api/pdf', async (req: Request, res: Response) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      if (!targetUrl) {
        res.status(400).json({ error: 'Missing url query parameter.' });
        return;
      }
      if (!targetUrl.startsWith(DAMIEN_CONSTANTS.baseUrl)) {
        res.status(400).json({ error: 'URL must start with https://app.helloalpha.com/damien-health' });
        return;
      }
      if (!fs.existsSync(PDF_TEMPLATE_PATH)) {
        res.status(500).json({ error: 'PDF template file not found on server.' });
        return;
      }

      const mode = String(req.query.mode || 'flyer').trim().toLowerCase();
      const refToken = formatPascalToken(
        String(req.query.ref || req.query.employer || 'Employer')
      );
      const filename =
        mode === 'packet'
          ? `2027-DC-Weight-Management-Packet-${refToken || 'Employer'}.pdf`
          : `2027-DC-Weight-Management-Flyer-${refToken || 'Employer'}.pdf`;

      const templateBytes = fs.readFileSync(PDF_TEMPLATE_PATH);
      const srcDoc = await PDFDocument.load(templateBytes);
      const pages = srcDoc.getPages();
      const flyerPage = pages[3]; // Page 4 is the enrollment flyer with QR & URL

      // Generate high-resolution QR code PNG for targetUrl
      const qrBuffer = await QRCode.toBuffer(targetUrl, {
        type: 'png',
        width: 500,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      const qrImg = await srcDoc.embedPng(qrBuffer);

      // 1. Stamp QR code over the existing QR square under "Scan to enroll"
      flyerPage.drawRectangle({
        x: 46.56,
        y: 70.8,
        width: 78.0,
        height: 78.0,
        color: rgb(1, 1, 1),
      });
      flyerPage.drawImage(qrImg, {
        x: 47.56,
        y: 71.8,
        width: 76.0,
        height: 76.0,
      });

      // 2. Cover old URL inside magenta "Enroll at:" banner and draw new URL + underline
      flyerPage.drawRectangle({
        x: 191.5,
        y: 146.2,
        width: 374.0,
        height: 15.5,
        color: rgb(0.6078, 0.2431, 0.5843),
      });

      const font = await srcDoc.embedFont(StandardFonts.Helvetica);
      const maxUrlWidth = 368.0;
      let fontSize = 8.6;
      let textWidth = font.widthOfTextAtSize(targetUrl, fontSize);
      while (textWidth > maxUrlWidth && fontSize > 6.2) {
        fontSize -= 0.2;
        textWidth = font.widthOfTextAtSize(targetUrl, fontSize);
      }

      flyerPage.drawText(targetUrl, {
        x: 192.6,
        y: 150.5,
        size: fontSize,
        font,
        color: rgb(1, 1, 1),
      });
      flyerPage.drawLine({
        start: { x: 192.6, y: 149.2 },
        end: { x: 192.6 + textWidth, y: 149.2 },
        thickness: 0.65,
        color: rgb(1, 1, 1),
      });

      // Build output document (either 1-page flyer or full 4-page packet)
      let outDoc: PDFDocument;
      let targetFlyerPage;
      if (mode === 'packet') {
        outDoc = srcDoc;
        targetFlyerPage = flyerPage;
      } else {
        outDoc = await PDFDocument.create();
        const [copiedFlyer] = await outDoc.copyPages(srcDoc, [3]);
        outDoc.addPage(copiedFlyer);
        targetFlyerPage = copiedFlyer;
      }

      // Attach clickable PDF Link annotations over both the URL banner and the QR code
      const linkBannerAnnot = outDoc.context.register(
        outDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [143.16, 131.88, 568.76, 164.18],
          Border: [0, 0, 0],
          A: {
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(targetUrl),
          },
        })
      );
      const linkQrAnnot = outDoc.context.register(
        outDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [46.56, 70.8, 124.56, 148.8],
          Border: [0, 0, 0],
          A: {
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(targetUrl),
          },
        })
      );
      targetFlyerPage.node.set(
        PDFName.of('Annots'),
        outDoc.context.obj([linkBannerAnnot, linkQrAnnot])
      );

      const pdfBytes = await outDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(pdfBytes));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate customized PDF.' });
    }
  });

  // Serve static frontend files
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().then((app) => {
    app.listen(port, () => {
      console.log(`Damien Center (Indiana) Link & QR Portal listening on http://localhost:${port}`);
    });
  });
}
