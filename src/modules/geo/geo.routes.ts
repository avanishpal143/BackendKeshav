import { Router } from 'express';
import { authenticate } from '../../shared/middleware/authenticate.js';
import { success } from '../../shared/response.js';
import { geoService } from './geo.service.js';
import { AppError } from '../../shared/AppError.js';

const router = Router();
router.use(authenticate);

// GET /geo/nearby?lat=28.58&lng=77.31&type=police&radius=10000
router.get('/nearby', async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const type = (req.query.type as string) ?? 'police';
    const radius = parseInt(req.query.radius as string ?? '10000', 10);

    if (isNaN(lat) || isNaN(lng)) {
      throw AppError.badRequest('lat and lng are required as numbers');
    }

    let places;
    if (type === 'hospital') {
      places = await geoService.nearbyHospitals(lat, lng, radius);
    } else {
      places = await geoService.nearbyPolice(lat, lng, radius);
    }

    success(res, places);
  } catch (err) {
    next(err);
  }
});

// GET /geo/reverse?lat=28.58&lng=77.31
router.get('/reverse', async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      throw AppError.badRequest('lat and lng required');
    }

    const address = await geoService.reverseGeocode(lat, lng);
    success(res, { address, lat, lng });
  } catch (err) {
    next(err);
  }
});

// GET /geo/sos-detail/:id — full SOS detail with reverse geocode + nearby responders
router.get('/sos-detail/:id', async (req, res, next) => {
  try {
    const { memStore } = await import('../../infrastructure/database/memoryStore.js');
    const sos = memStore.sosAlerts.find(s => s.id === req.params.id);
    if (!sos) throw AppError.notFound('SOS alert not found');

    const lat = sos.latitude;
    const lng = sos.longitude;

    // Run all 3 in parallel
    const [address, nearbyPolice, nearbyHospitals] = await Promise.all([
      geoService.reverseGeocode(lat, lng),
      geoService.nearbyPolice(lat, lng, 8000),
      geoService.nearbyHospitals(lat, lng, 8000),
    ]);

    // Update the stored address
    sos.address = address;

    success(res, {
      ...sos,
      address,
      nearbyPolice: nearbyPolice.slice(0, 3),
      nearbyHospitals: nearbyHospitals.slice(0, 3),
      mapsEmbedUrl: `https://www.google.com/maps?q=${lat},${lng}&z=15&output=embed`,
      mapsUrl: `https://www.google.com/maps?q=${lat},${lng}&z=15`,
      googleMapsDirectUrl: `https://maps.google.com/?q=${lat},${lng}`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
