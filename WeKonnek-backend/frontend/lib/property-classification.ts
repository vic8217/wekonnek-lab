export const PROPERTY_GROUPS = [
  "Residential",
  "Commercial",
  "Land & Other",
] as const;

export const PROPERTY_TYPE_OPTIONS = [
  {
    slug: "house-and-lot",
    label: "House & Lot",
    group: "Residential",
    fields: [
      "bedrooms",
      "bathrooms",
      "floorArea",
      "lotArea",
      "numberOfFloors",
      "parkingSpaces",
      "furnishedStatus",
    ],
  },
  {
    slug: "condominium",
    label: "Condominium",
    group: "Residential",
    fields: [
      "developmentName",
      "bedrooms",
      "bathrooms",
      "floorArea",
      "parkingSpaces",
      "furnishedStatus",
      "floorLevel",
      "amenities",
    ],
  },
  {
    slug: "apartment",
    label: "Apartment",
    group: "Residential",
    fields: [
      "bedrooms",
      "bathrooms",
      "floorArea",
      "furnishedStatus",
      "parkingSpaces",
    ],
  },
  {
    slug: "townhouse",
    label: "Townhouse",
    group: "Residential",
    fields: [
      "bedrooms",
      "bathrooms",
      "floorArea",
      "lotArea",
      "numberOfFloors",
      "parkingSpaces",
      "furnishedStatus",
    ],
  },
  {
    slug: "room-bedspace",
    label: "Room / Bedspace",
    group: "Residential",
    fields: [
      "roomType",
      "occupancyType",
      "maximumOccupants",
      "bathroomType",
      "furnishedStatus",
    ],
  },
  {
    slug: "residential-lot",
    label: "Residential Lot",
    group: "Residential",
    fields: [
      "lotArea",
      "lotDimensions",
      "roadAccess",
      "cornerLot",
      "titleType",
    ],
  },
  {
    slug: "office-space",
    label: "Office Space",
    group: "Commercial",
    fields: [
      "floorArea",
      "fitOutStatus",
      "parkingSpaces",
      "floorLevel",
      "buildingName",
    ],
  },
  {
    slug: "retail-commercial-space",
    label: "Retail / Commercial Space",
    group: "Commercial",
    fields: [
      "floorArea",
      "frontage",
      "parkingSpaces",
      "floorLevel",
      "commercialUse",
      "fitOutStatus",
    ],
  },
  {
    slug: "warehouse",
    label: "Warehouse",
    group: "Commercial",
    fields: [
      "floorArea",
      "lotArea",
      "clearHeight",
      "loadingAccess",
      "truckAccess",
      "parkingSpaces",
    ],
  },
  {
    slug: "building",
    label: "Building",
    group: "Commercial",
    fields: [
      "lotArea",
      "floorArea",
      "numberOfFloors",
      "parkingSpaces",
      "buildingUse",
    ],
  },
  {
    slug: "commercial-lot",
    label: "Commercial Lot",
    group: "Commercial",
    fields: [
      "lotArea",
      "lotDimensions",
      "roadAccess",
      "cornerLot",
      "titleType",
    ],
  },
  {
    slug: "agricultural-farm-land",
    label: "Agricultural / Farm Land",
    group: "Land & Other",
    fields: [
      "lotArea",
      "lotDimensions",
      "roadAccess",
      "cornerLot",
      "titleType",
    ],
  },
  {
    slug: "industrial-property",
    label: "Industrial Property",
    group: "Land & Other",
    fields: [
      "floorArea",
      "lotArea",
      "roadAccess",
      "truckAccess",
      "parkingSpaces",
    ],
  },
  {
    slug: "industrial-lot",
    label: "Industrial Lot",
    group: "Land & Other",
    fields: [
      "lotArea",
      "lotDimensions",
      "roadAccess",
      "cornerLot",
      "titleType",
    ],
  },
  {
    slug: "raw-vacant-land",
    label: "Raw / Vacant Land",
    group: "Land & Other",
    fields: [
      "lotArea",
      "lotDimensions",
      "roadAccess",
      "cornerLot",
      "titleType",
    ],
  },
  {
    slug: "resort-leisure-property",
    label: "Resort / Leisure Property",
    group: "Land & Other",
    fields: [
      "bedrooms",
      "bathrooms",
      "floorArea",
      "lotArea",
      "parkingSpaces",
      "amenities",
    ],
  },
  {
    slug: "parking-space",
    label: "Parking Space",
    group: "Land & Other",
    fields: ["floorArea", "buildingName"],
  },
  {
    slug: "other-property",
    label: "Other Property",
    group: "Land & Other",
    fields: ["floorArea", "lotArea"],
  },
] as const;

export const LISTER_TYPE_OPTIONS = [
  ["OWNER", "Property Owner"],
  ["AUTHORIZED_REPRESENTATIVE", "Authorized Representative"],
  ["BROKER", "Licensed Real Estate Broker"],
  ["SALESPERSON", "Licensed Real Estate Salesperson"],
  ["DEVELOPER", "Property Developer"],
] as const;

export const propertyTypeDefinition = (slug?: string) =>
  PROPERTY_TYPE_OPTIONS.find((item) => item.slug === slug);
export const listerTypeLabel = (value?: string) =>
  LISTER_TYPE_OPTIONS.find((item) => item[0] === value)?.[1] ||
  value?.replaceAll("_", " ") ||
  "Property Owner";
