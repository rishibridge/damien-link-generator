import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';

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
  ceName: string;
  state: string;
  baseUrl: string;
  updatedAt: string;
  brokers: BrokerEntry[];
  generatedLinks: GeneratedLinkEntry[];
}

const DAMIEN_CONSTANTS = {
  ceName: 'Damien Center',
  state: 'Indiana',
  baseUrl: 'https://app.helloalpha.com/damien-health',
};

export function formatPascalToken(input: string): string {
  if (!input || !input.trim()) return '';
  return input
    .trim()
    .replace(/['’]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

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
  brokerName: string,
  employerName: string,
  couponCode: string
): { url: string; refCode: string; couponCode: string } {
  const cleanBroker = formatPascalToken(brokerName);
  const cleanEmployer = formatPascalToken(employerName);
  const refCode = `${cleanBroker}${cleanEmployer}`;
  const cleanCoupon = String(couponCode || '').trim();

  let url = `${DAMIEN_CONSTANTS.baseUrl}?ref=${encodeURIComponent(refCode)}`;
  if (cleanCoupon) {
    url += `&coupon=${encodeURIComponent(cleanCoupon)}`;
  }

  return { url, refCode, couponCode: cleanCoupon };
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
      couponCode: 'firstmonthDamien',
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
  const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
  const parsed = JSON.parse(raw) as DamienConfig;
  return ensureDirectBroker(parsed);
}

function saveConfig(config: DamienConfig): DamienConfig {
  ensureDirectBroker(config);
  config.version = (config.version || 1) + 1;
  config.updatedAt = new Date().toISOString();
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

export async function createServer() {
  let stateConfig = loadConfig();

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // 1. Bootstrap endpoint
  app.get('/api/bootstrap', (_req: Request, res: Response) => {
    stateConfig = loadConfig();
    res.json({
      config: stateConfig,
    });
  });

  // 2. Upsert Broker + Already-Created Coupon
  app.post('/api/brokers/upsert', (req: Request, res: Response) => {
    try {
      const { id, name, couponCode } = req.body;
      stateConfig = loadConfig();

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

  // 3. Delete Broker (protects built-in Damien Direct broker)
  app.post('/api/brokers/delete', (req: Request, res: Response) => {
    try {
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

      stateConfig = loadConfig();
      stateConfig.brokers = stateConfig.brokers.filter(
        (b) => b.id.toLowerCase() !== String(id).toLowerCase()
      );
      saveConfig(stateConfig);

      res.json({
        brokers: stateConfig.brokers,
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
      const { url, refCode, couponCode } = buildDamienEmployerUrl(
        broker.name,
        cleanEmployer,
        broker.couponCode
      );

      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 420,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });

      const entryId = `${broker.id}__${formatSlug(cleanEmployer)}`;
      const record: GeneratedLinkEntry = {
        id: entryId,
        brokerId: broker.id,
        brokerName: broker.name,
        employerName: cleanEmployer,
        refCode,
        couponCode,
        url,
        createdAt: new Date().toISOString(),
      };

      stateConfig.generatedLinks = stateConfig.generatedLinks.filter((g) => g.id !== entryId);
      stateConfig.generatedLinks.unshift(record);
      if (stateConfig.generatedLinks.length > 100) {
        stateConfig.generatedLinks = stateConfig.generatedLinks.slice(0, 100);
      }
      saveConfig(stateConfig);

      const qrDownloadUrl = `/api/qr.png?url=${encodeURIComponent(url)}&employer=${encodeURIComponent(
        cleanEmployer
      )}&broker=${encodeURIComponent(broker.name)}`;

      res.json({
        result: {
          ...record,
          ceName: DAMIEN_CONSTANTS.ceName,
          state: DAMIEN_CONSTANTS.state,
          qrDataUrl,
          qrDownloadUrl,
        },
        generatedLinks: stateConfig.generatedLinks,
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
