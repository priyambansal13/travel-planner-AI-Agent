/**
 * Indian travel reference data: nearest airport (IATA) and railhead (Indian Railways
 * station code) for popular origins / destinations, plus a pricing tier used by the
 * fare/tariff estimators when no live inventory API is configured.
 */
export interface Gateway {
  airport?: { code: string; name: string; note?: string };
  station?: { code: string; name: string; note?: string };
  tier: 'metro' | 'tier2' | 'leisure' | 'hill' | 'remote';
}

const G: Record<string, Gateway> = {
  delhi: { airport: { code: 'DEL', name: 'Indira Gandhi Intl, Delhi' }, station: { code: 'NDLS', name: 'New Delhi' }, tier: 'metro' },
  mumbai: { airport: { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj Intl, Mumbai' }, station: { code: 'MMCT', name: 'Mumbai Central' }, tier: 'metro' },
  bengaluru: { airport: { code: 'BLR', name: 'Kempegowda Intl, Bengaluru' }, station: { code: 'SBC', name: 'KSR Bengaluru' }, tier: 'metro' },
  chennai: { airport: { code: 'MAA', name: 'Chennai Intl' }, station: { code: 'MAS', name: 'Chennai Central' }, tier: 'metro' },
  kolkata: { airport: { code: 'CCU', name: 'Netaji Subhas Chandra Bose Intl, Kolkata' }, station: { code: 'HWH', name: 'Howrah Jn' }, tier: 'metro' },
  hyderabad: { airport: { code: 'HYD', name: 'Rajiv Gandhi Intl, Hyderabad' }, station: { code: 'SC', name: 'Secunderabad Jn' }, tier: 'metro' },
  pune: { airport: { code: 'PNQ', name: 'Pune Airport' }, station: { code: 'PUNE', name: 'Pune Jn' }, tier: 'tier2' },
  ahmedabad: { airport: { code: 'AMD', name: 'Sardar Vallabhbhai Patel Intl, Ahmedabad' }, station: { code: 'ADI', name: 'Ahmedabad Jn' }, tier: 'tier2' },
  jaipur: { airport: { code: 'JAI', name: 'Jaipur Intl' }, station: { code: 'JP', name: 'Jaipur Jn' }, tier: 'leisure' },
  goa: { airport: { code: 'GOI', name: 'Dabolim (Goa)', note: 'Mopa (GOX) also serves North Goa' }, station: { code: 'MAO', name: 'Madgaon Jn' }, tier: 'leisure' },
  udaipur: { airport: { code: 'UDR', name: 'Maharana Pratap Airport, Udaipur' }, station: { code: 'UDZ', name: 'Udaipur City' }, tier: 'leisure' },
  jodhpur: { airport: { code: 'JDH', name: 'Jodhpur Airport' }, station: { code: 'JU', name: 'Jodhpur Jn' }, tier: 'leisure' },
  jaisalmer: { airport: { code: 'JDH', name: 'Jodhpur Airport', note: '~285 km; Jaisalmer (JSA) has limited seasonal flights' }, station: { code: 'JSM', name: 'Jaisalmer' }, tier: 'leisure' },
  pushkar: { airport: { code: 'JAI', name: 'Jaipur Intl', note: '~145 km' }, station: { code: 'AII', name: 'Ajmer Jn', note: '~15 km from Pushkar' }, tier: 'leisure' },
  agra: { airport: { code: 'DEL', name: 'Delhi', note: '~230 km; Agra (AGR) has limited flights' }, station: { code: 'AGC', name: 'Agra Cantt' }, tier: 'leisure' },
  varanasi: { airport: { code: 'VNS', name: 'Lal Bahadur Shastri Intl, Varanasi' }, station: { code: 'BSB', name: 'Varanasi Jn' }, tier: 'leisure' },
  lucknow: { airport: { code: 'LKO', name: 'Chaudhary Charan Singh Intl, Lucknow' }, station: { code: 'LKO', name: 'Lucknow Charbagh' }, tier: 'tier2' },
  amritsar: { airport: { code: 'ATQ', name: 'Sri Guru Ram Dass Jee Intl, Amritsar' }, station: { code: 'ASR', name: 'Amritsar Jn' }, tier: 'leisure' },
  chandigarh: { airport: { code: 'IXC', name: 'Chandigarh Intl' }, station: { code: 'CDG', name: 'Chandigarh' }, tier: 'tier2' },
  shimla: { airport: { code: 'IXC', name: 'Chandigarh Intl', note: '~115 km' }, station: { code: 'KLK', name: 'Kalka', note: 'UNESCO toy train Kalka→Shimla' }, tier: 'hill' },
  manali: { airport: { code: 'KUU', name: 'Bhuntar (Kullu)', note: '~50 km; limited flights, else Chandigarh IXC ~300 km' }, station: { code: 'CDG', name: 'Chandigarh', note: 'no railhead nearby; ~300 km by road' }, tier: 'hill' },
  dharamshala: { airport: { code: 'DHM', name: 'Gaggal (Kangra)' }, station: { code: 'PTKC', name: 'Pathankot Cantt', note: '~85 km' }, tier: 'hill' },
  rishikesh: { airport: { code: 'DED', name: 'Jolly Grant, Dehradun', note: '~20 km' }, station: { code: 'YNRK', name: 'Yog Nagari Rishikesh' }, tier: 'leisure' },
  haridwar: { airport: { code: 'DED', name: 'Jolly Grant, Dehradun', note: '~35 km' }, station: { code: 'HW', name: 'Haridwar Jn' }, tier: 'leisure' },
  dehradun: { airport: { code: 'DED', name: 'Jolly Grant, Dehradun' }, station: { code: 'DDN', name: 'Dehradun' }, tier: 'tier2' },
  mussoorie: { airport: { code: 'DED', name: 'Jolly Grant, Dehradun', note: '~60 km' }, station: { code: 'DDN', name: 'Dehradun', note: '~35 km' }, tier: 'hill' },
  nainital: { airport: { code: 'PGH', name: 'Pantnagar', note: '~65 km; limited flights' }, station: { code: 'KGM', name: 'Kathgodam', note: '~35 km' }, tier: 'hill' },
  leh: { airport: { code: 'IXL', name: 'Kushok Bakula Rimpochee, Leh' }, tier: 'remote' },
  ladakh: { airport: { code: 'IXL', name: 'Kushok Bakula Rimpochee, Leh' }, tier: 'remote' },
  srinagar: { airport: { code: 'SXR', name: 'Srinagar Intl' }, station: { code: 'SINA', name: 'Srinagar' }, tier: 'hill' },
  jammu: { airport: { code: 'IXJ', name: 'Jammu Airport' }, station: { code: 'JAT', name: 'Jammu Tawi' }, tier: 'tier2' },
  katra: { airport: { code: 'IXJ', name: 'Jammu Airport', note: '~50 km' }, station: { code: 'SVDK', name: 'Shri Mata Vaishno Devi Katra' }, tier: 'leisure' },
  darjeeling: { airport: { code: 'IXB', name: 'Bagdogra', note: '~70 km' }, station: { code: 'NJP', name: 'New Jalpaiguri', note: '~75 km; toy train available' }, tier: 'hill' },
  gangtok: { airport: { code: 'IXB', name: 'Bagdogra', note: '~125 km; Pakyong (PYG) limited' }, station: { code: 'NJP', name: 'New Jalpaiguri', note: '~120 km' }, tier: 'hill' },
  guwahati: { airport: { code: 'GAU', name: 'Lokpriya Gopinath Bordoloi Intl, Guwahati' }, station: { code: 'GHY', name: 'Guwahati' }, tier: 'tier2' },
  shillong: { airport: { code: 'GAU', name: 'Guwahati', note: '~120 km' }, station: { code: 'GHY', name: 'Guwahati', note: '~100 km' }, tier: 'hill' },
  bhubaneswar: { airport: { code: 'BBI', name: 'Biju Patnaik Intl, Bhubaneswar' }, station: { code: 'BBS', name: 'Bhubaneswar' }, tier: 'tier2' },
  puri: { airport: { code: 'BBI', name: 'Bhubaneswar', note: '~60 km' }, station: { code: 'PURI', name: 'Puri' }, tier: 'leisure' },
  kochi: { airport: { code: 'COK', name: 'Cochin Intl' }, station: { code: 'ERS', name: 'Ernakulam Jn' }, tier: 'tier2' },
  munnar: { airport: { code: 'COK', name: 'Cochin Intl', note: '~110 km' }, station: { code: 'AWY', name: 'Aluva', note: '~110 km' }, tier: 'hill' },
  alleppey: { airport: { code: 'COK', name: 'Cochin Intl', note: '~80 km' }, station: { code: 'ALLP', name: 'Alappuzha' }, tier: 'leisure' },
  alappuzha: { airport: { code: 'COK', name: 'Cochin Intl', note: '~80 km' }, station: { code: 'ALLP', name: 'Alappuzha' }, tier: 'leisure' },
  thiruvananthapuram: { airport: { code: 'TRV', name: 'Thiruvananthapuram Intl' }, station: { code: 'TVC', name: 'Thiruvananthapuram Central' }, tier: 'tier2' },
  varkala: { airport: { code: 'TRV', name: 'Thiruvananthapuram Intl', note: '~45 km' }, station: { code: 'VAK', name: 'Varkala Sivagiri' }, tier: 'leisure' },
  mysuru: { airport: { code: 'BLR', name: 'Bengaluru', note: '~170 km; Mysuru (MYQ) limited' }, station: { code: 'MYS', name: 'Mysuru Jn' }, tier: 'leisure' },
  mysore: { airport: { code: 'BLR', name: 'Bengaluru', note: '~170 km; Mysuru (MYQ) limited' }, station: { code: 'MYS', name: 'Mysuru Jn' }, tier: 'leisure' },
  coorg: { airport: { code: 'IXE', name: 'Mangaluru Intl', note: '~140 km' }, station: { code: 'MYS', name: 'Mysuru Jn', note: '~120 km' }, tier: 'hill' },
  ooty: { airport: { code: 'CJB', name: 'Coimbatore Intl', note: '~85 km' }, station: { code: 'MTP', name: 'Mettupalayam', note: 'Nilgiri toy train to Ooty' }, tier: 'hill' },
  kodaikanal: { airport: { code: 'IXM', name: 'Madurai', note: '~120 km' }, station: { code: 'KQN', name: 'Kodaikanal Road', note: '~80 km' }, tier: 'hill' },
  madurai: { airport: { code: 'IXM', name: 'Madurai Airport' }, station: { code: 'MDU', name: 'Madurai Jn' }, tier: 'tier2' },
  coimbatore: { airport: { code: 'CJB', name: 'Coimbatore Intl' }, station: { code: 'CBE', name: 'Coimbatore Jn' }, tier: 'tier2' },
  pondicherry: { airport: { code: 'MAA', name: 'Chennai', note: '~150 km' }, station: { code: 'PDY', name: 'Puducherry' }, tier: 'leisure' },
  puducherry: { airport: { code: 'MAA', name: 'Chennai', note: '~150 km' }, station: { code: 'PDY', name: 'Puducherry' }, tier: 'leisure' },
  hampi: { airport: { code: 'HBX', name: 'Hubballi', note: '~165 km' }, station: { code: 'HPT', name: 'Hosapete Jn', note: '~13 km' }, tier: 'leisure' },
  gokarna: { airport: { code: 'GOI', name: 'Goa Dabolim', note: '~140 km' }, station: { code: 'GOK', name: 'Gokarna Road' }, tier: 'leisure' },
  mangaluru: { airport: { code: 'IXE', name: 'Mangaluru Intl' }, station: { code: 'MAQ', name: 'Mangaluru Central' }, tier: 'tier2' },
  visakhapatnam: { airport: { code: 'VTZ', name: 'Visakhapatnam' }, station: { code: 'VSKP', name: 'Visakhapatnam' }, tier: 'tier2' },
  bhopal: { airport: { code: 'BHO', name: 'Raja Bhoj, Bhopal' }, station: { code: 'BPL', name: 'Bhopal Jn' }, tier: 'tier2' },
  indore: { airport: { code: 'IDR', name: 'Devi Ahilya Bai Holkar, Indore' }, station: { code: 'INDB', name: 'Indore Jn' }, tier: 'tier2' },
  khajuraho: { airport: { code: 'HJR', name: 'Khajuraho' }, station: { code: 'KURJ', name: 'Khajuraho' }, tier: 'leisure' },
  patna: { airport: { code: 'PAT', name: 'Jay Prakash Narayan, Patna' }, station: { code: 'PNBE', name: 'Patna Jn' }, tier: 'tier2' },
  'bodh gaya': { airport: { code: 'GAY', name: 'Gaya' }, station: { code: 'GAYA', name: 'Gaya Jn', note: '~15 km' }, tier: 'leisure' },
  ranchi: { airport: { code: 'IXR', name: 'Birsa Munda, Ranchi' }, station: { code: 'RNC', name: 'Ranchi' }, tier: 'tier2' },
  nagpur: { airport: { code: 'NAG', name: 'Dr. Babasaheb Ambedkar Intl, Nagpur' }, station: { code: 'NGP', name: 'Nagpur' }, tier: 'tier2' },
  lonavala: { airport: { code: 'PNQ', name: 'Pune', note: '~65 km' }, station: { code: 'LNL', name: 'Lonavala' }, tier: 'hill' },
  mahabaleshwar: { airport: { code: 'PNQ', name: 'Pune', note: '~120 km' }, station: { code: 'STR', name: 'Satara', note: '~55 km' }, tier: 'hill' },
  'mount abu': { airport: { code: 'UDR', name: 'Udaipur', note: '~165 km' }, station: { code: 'ABR', name: 'Abu Road', note: '~28 km' }, tier: 'hill' },
  bhuj: { airport: { code: 'BHJ', name: 'Bhuj' }, station: { code: 'BHUJ', name: 'Bhuj' }, tier: 'leisure' },
  'port blair': { airport: { code: 'IXZ', name: 'Veer Savarkar Intl, Port Blair' }, tier: 'remote' },
  andaman: { airport: { code: 'IXZ', name: 'Veer Savarkar Intl, Port Blair' }, tier: 'remote' },
  surat: { airport: { code: 'STV', name: 'Surat' }, station: { code: 'ST', name: 'Surat' }, tier: 'tier2' },
  vadodara: { airport: { code: 'BDQ', name: 'Vadodara' }, station: { code: 'BRC', name: 'Vadodara Jn' }, tier: 'tier2' },
};

const ALIASES: Record<string, string> = {
  'new delhi': 'delhi', bangalore: 'bengaluru', bombay: 'mumbai', madras: 'chennai', calcutta: 'kolkata',
  cochin: 'kochi', ernakulam: 'kochi', trivandrum: 'thiruvananthapuram', mangalore: 'mangaluru',
  vizag: 'visakhapatnam', 'north goa': 'goa', 'south goa': 'goa', panaji: 'goa', panjim: 'goa',
  kodagu: 'coorg', madikeri: 'coorg', udhagamandalam: 'ooty', gurgaon: 'delhi', gurugram: 'delhi',
  noida: 'delhi', 'navi mumbai': 'mumbai', thane: 'mumbai', kullu: 'manali', mcleodganj: 'dharamshala',
  'mcleod ganj': 'dharamshala', 'havelock': 'andaman', 'swaraj dweep': 'andaman', kutch: 'bhuj',
};

export function resolveGateway(place: string): (Gateway & { key: string }) | null {
  const p = place.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const direct = ALIASES[p] ?? (G[p] ? p : undefined);
  if (direct) return { key: direct, ...G[direct] };
  // substring match against aliases first (e.g. "North Goa beaches"), then gateway keys
  for (const [alias, key] of Object.entries(ALIASES)) if (p.includes(alias)) return { key, ...G[key] };
  for (const key of Object.keys(G)) if (p.split(' ').includes(key) || p.includes(key)) return { key, ...G[key] };
  return null;
}

/** Hotel nightly tariff bands (INR, per room) by budget level, scaled by destination tier. */
export const TARIFF_BANDS = {
  budget: [1200, 3000],
  moderate: [3500, 8000],
  luxury: [10000, 28000],
} as const;

export const TIER_MULTIPLIER: Record<Gateway['tier'], number> = {
  metro: 1.2, tier2: 0.9, leisure: 1.1, hill: 1.0, remote: 1.25,
};
