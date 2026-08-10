export type NcrCouncilArea = { code: string; name: string };

const slug = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const list = (city: string, district: string, value: string): NcrCouncilArea[] =>
  value.split(';').map(name => name.trim()).filter(Boolean).map(name => ({ code: `${slug(city)}-${slug(district)}-${slug(name)}`, name }));

// WEKONNEK NCR Local Council District → Area/Barangay Mapping, updated Aug 2026.
// The keys are PSGC locality codes. Local council district is operational;
// congressional district remains a separate reference in the source document.
export const NCR_COUNCIL_AREAS: Record<string, Record<string, NcrCouncilArea[]>> = {
  '133900000': {
    '1st District': list('Manila', '1', 'Tondo (western portion) — Barangays 1–146'),
    '2nd District': list('Manila', '2', 'Tondo (eastern portion) — Barangays 147–267'),
    '3rd District': list('Manila', '3', 'Binondo; Quiapo; San Nicolas; Santa Cruz'),
    '4th District': list('Manila', '4', 'Sampaloc — Barangays 395–586'),
    '5th District': list('Manila', '5', 'Ermita; Intramuros; Malate; Port Area; San Andres'),
    '6th District': list('Manila', '6', 'Paco; Pandacan; San Miguel; Santa Ana; Santa Mesa'),
  },
  '137404000': {
    '1st District': list('Quezon City', '1', 'Alicia; Bagong Pag-asa; Bahay Toro; Balingasa; Bungad; Damar; Damayan; Del Monte; Katipunan; Mariblo; Masambong; N.S. Amoranto; Nayong Kanluran; Paang Bundok; Pag-ibig sa Nayon; Paltok; Paraiso; Phil-Am; Ramon Magsaysay; Salvacion; San Antonio; San Isidro Labrador; San Jose; Santa Cruz; Santa Teresita; Santo Cristo; Talayan; Veterans Village; West Triangle'),
    '2nd District': list('Quezon City', '2', 'Bagong Silangan; Batasan Hills; Commonwealth; Holy Spirit; Payatas'),
    '3rd District': list('Quezon City', '3', 'Amihan; Bagumbuhay; Bagumbayan; Bayanihan; Blue Ridge A; Blue Ridge B; Camp Aguinaldo; Claro; Dioquino Zobel; Duyan-Duyan; E. Rodriguez; East Kamias; Escopa I-IV; Libis; Loyola Heights; Mangga; Marilag; Masagana; Matandang Balara; Milagrosa; Pansol; Quirino 2-A, 2-B, 2-C, 3-A; Saint Ignatius; San Roque; Silangan; Socorro; Tagumpay; Ugong Norte; Villa Maria Clara; West Kamias; White Plains'),
    '4th District': list('Quezon City', '4', 'Bagong Lipunan ng Crame; Botocan; Central; Damayang Lagi; Dona Aurora; Dona Imelda; Dona Josefa; Don Manuel; Horseshoe; Immaculate Conception; Kalusugan; Kamuning; Kaunlaran; Kristong Hari; Krus na Ligas; Laging Handa; Malaya; Mariana; Obrero; Old Capitol Site; Paligsahan; Pinagkaisahan; Pinyahan; Roxas; Sacred Heart; San Isidro Galas; San Martin de Porres; San Vicente; Santol; Santo Nino; Sikatuna Village; South Triangle; Tatalon; Teachers Village East; Teachers Village West; U.P. Campus; U.P. Village; Valencia'),
    '5th District': list('Quezon City', '5', 'Bagbag; Capri; Fairview; Greater Lagro; Gulod; Kaligayahan; Nagkaisang Nayon; North Fairview; Novaliches Proper; Pasong Putik Proper; San Agustin; San Bartolome; Santa Lucia; Santa Monica'),
    '6th District': list('Quezon City', '6', 'Apolonio Samson; Baesa; Balon-Bato; Culiat; New Era; Pasong Tamo; Sangandaan; Sauyo; Talipapa; Tandang Sora; Unang Sigaw'),
  },
  '137501000': {
    '1st District': list('Caloocan', '1', 'South Caloocan + part of North Caloocan — Barangays 1–4, 77–85, 132–177'),
    '2nd District': list('Caloocan', '2', 'South Caloocan — Barangays 5–76, 86–131'),
    '3rd District': list('Caloocan', '3', 'North Caloocan — Barangays 178–188'),
  },
  '137602000': {
    '1st District': list('Makati', '1', 'Bangkal; Bel-Air; Carmona; Dasmarinas; Forbes Park; Kasilawan; La Paz; Magallanes; Olympia; Palanan; Pio del Pilar; Poblacion; San Antonio; San Isidro; San Lorenzo; Singkamas; Santa Cruz; Tejeros; Urdaneta; Valenzuela'),
    '2nd District': list('Makati', '2', 'Guadalupe Nuevo; Guadalupe Viejo; Pinagkaisahan'),
  },
  '137402000': {
    '1st District': list('Marikina', '1', 'Barangka; Calumpang; Industrial Valley; Jesus de la Pena; Malanday; San Roque; Santa Elena; Santo Nino; Tanong'),
    '2nd District': list('Marikina', '2', 'Concepcion Uno; Concepcion Dos; Fortune; Marikina Heights; Nangka; Parang; Tumana'),
  },
  '137604000': {
    '1st District': list('Paranaque', '1', 'Baclaran; Don Galo; La Huerta; San Dionisio; San Isidro; Santo Nino; Tambo; Vitalez'),
    '2nd District': list('Paranaque', '2', 'BF Homes; Don Bosco; Marcelo Green Village; Merville; Moonwalk; San Antonio; San Martin de Porres; Sun Valley'),
  },
  '137504000': {
    '1st District': list('Valenzuela', '1', 'Arkong Bato; Balangkas; Bignay; Bisig; Canumay East; Canumay West; Coloong; Dalandanan; Isla; Lawang Bato; Lingunan; Mabolo; Malanday; Malinta; Palasan; Pariancillo Villa; Pasolo; Poblacion; Pulo; Punturin; Rincon; Tagalag; Veinte Reales; Wawang Pulo'),
    '2nd District': list('Valenzuela', '2', 'Bagbaguin; Gen. T. de Leon; Karuhatan; Mapulang Lupa; Marulas; Maysan; Parada; Paso de Blas; Ugong'),
  },
  '137403000': {
    '1st District': list('Pasig', '1', 'Bagong Ilog; Bagong Katipunan; Bambang; Buting; Caniogan; Kalawaan; Kapasigan; Kapitolyo; Malinao; Oranbo; Palatiw; Pineda; Sagad; San Antonio; San Joaquin; San Jose; San Nicolas; Santa Cruz; Santa Rosa; Santo Tomas; Sumilang; Ugong'),
    '2nd District': list('Pasig', '2', 'Dela Paz; Manggahan; Maybunga; Pinagbuhatan; Rosario; San Isidro; San Miguel; Santa Lucia; Santolan'),
  },
  '137401000': {
    '1st District': list('Mandaluyong', '1', 'Addition Hills; Bagong Silang; Burol; Daang Bakal; Hagdan Bato Itaas; Hagdan Bato Libis; Harapin Ang Bukas; Highway Hills; Mauway; New Zaniga; Pag-asa; Pleasant Hills; Poblacion; Wack-Wack Greenhills East'),
    '2nd District': list('Mandaluyong', '2', 'Barangka Drive; Barangka Ibaba; Barangka Ilaya; Barangka Itaas; Buayang Bato; Hulo; Mabini-J. Rizal; Malamig; Namayan; Old Zaniga; Plainview; San Jose; Vergara'),
  },
  '137605000': {
    '1st District': list('Pasay', '1', 'Northern / western / central Pasay — Barangays 1–40, 68–92, 145–157, 183–201'),
    '2nd District': list('Pasay', '2', 'Southern / eastern Pasay — Barangays 41–67, 93–144, 158–182'),
  },
  '137601000': {
    '1st District': list('Las Pinas', '1', 'BF International/CAA; Daniel Fajardo; Elias Aldana; Ilaya; Manuyo Uno; Manuyo Dos; Pamplona Uno; Pamplona Tres; Pulang Lupa Uno; Pulang Lupa Dos; Zapote'),
    '2nd District': list('Las Pinas', '2', 'Almanza Uno; Almanza Dos; Pamplona Dos; Pilar; Talon Uno; Talon Dos; Talon Tres; Talon Kuatro; Talon Singko'),
  },
  '137603000': {
    '1st District': list('Muntinlupa', '1', 'Bayanan; Poblacion; Putatan; Tunasan'),
    '2nd District': list('Muntinlupa', '2', 'Alabang; Ayala Alabang; Buli; Cupang; Sucat'),
  },
  '137502000': {
    '1st District': list('Malabon', '1', 'Baritan; Bayan-bayanan; Catmon; Concepcion; Dampalit; Flores; Hulong Duhat; Ibaba; Maysilo; Muzon; Niugan; Panghulo; San Agustin; Santulan; Tanong'),
    '2nd District': list('Malabon', '2', 'Acacia; Longos; Potrero; Tinajeros; Tonsuya; Tugatog'),
  },
  '137503000': {
    '1st District': list('Navotas', '1', 'San Rafael Village; North Bay Boulevard South; North Bay Boulevard North; Bangkulasi; Bagumbayan South; Bagumbayan North; Navotas East; Navotas West; Sipac-Almacen'),
    '2nd District': list('Navotas', '2', 'Tanza; Tangos; San Roque; Daanghari; San Jose'),
  },
  '137405000': {
    '1st District': list('San Juan', '1', 'Balong-Bato; Batis; Corazon de Jesus; Ermitano; Pasadena; Pedro Cruz; Progreso; Rivera; Salapan; San Perfecto'),
    '2nd District': list('San Juan', '2', 'Addition Hills; Greenhills; Isabelita; Kabayanan; Little Baguio; Maytunas; Onse; Saint Joseph; Santa Lucia; Tibagan; West Crame'),
  },
  '137607000': {
    '1st District': list('Taguig', '1', 'Bagumbayan; Bambang; Calzada-Tipas; Hagonoy; Ibayo-Tipas; Ligid-Tipas; Lower Bicutan; New Lower Bicutan; Napindan; Palingon; San Miguel; Santa Ana; Tuktukan; Ususan; Wawa; Comembo; Pembo; Rizal'),
    '2nd District': list('Taguig', '2', 'Central Bicutan; Central Signal Village; Fort Bonifacio; Katuparan; Maharlika Village; North Daang Hari; North Signal Village; Pinagsama; South Daang Hari; South Signal Village; Tanyag; Upper Bicutan; Western Bicutan; Cembo; East Rembo; Pitogo; Post Proper Northside; Post Proper Southside; South Cembo; West Rembo'),
  },
  '137606000': {
    '1st District': list('Pateros', '1', 'Martires del 96; San Roque; Santa Ana'),
    '2nd District': list('Pateros', '2', 'Aguho; Magtanggol; Poblacion; San Pedro; Santo Rosario-Kanluran; Santo Rosario-Silangan; Tabacalera'),
  },
};

export const NCR_CITY_COUNCIL_DISTRICTS = Object.fromEntries(
  Object.entries(NCR_COUNCIL_AREAS).map(([code, districts]) => [code, Object.keys(districts)]),
);
