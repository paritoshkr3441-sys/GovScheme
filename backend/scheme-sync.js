
const https = require("https");
const fs = require("fs");
const path = require("path");

const schemesFile = path.join(__dirname, "schemes.json");

const API_URL =
  "https://apisetu.gov.in/meity/myscheme/srv/v7/search/schemes";

// Read existing local schemes safely
function readSchemes() {
  try {
    const data = JSON.parse(
      fs.readFileSync(schemesFile, "utf8")
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Could not read schemes.json:", error.message);
    return [];
  }
}

// Save schemes to local JSON file
function saveSchemes(schemes) {
  fs.writeFileSync(
    schemesFile,
    JSON.stringify(schemes, null, 2),
    "utf8"
  );
}

// Request API data
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { Accept: "application/json" } },
      response => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", chunk => body += chunk);

        response.on("end", () => {
          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(`API returned HTTP ${response.statusCode}`)
            );
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid JSON returned by API."));
          }
        });
      }
    ).on("error", reject);
  });
}

// Convert API response into our local scheme format
function normalizeScheme(raw) {
  const data = raw?.data || raw;
  const details = data?.en?.basicDetails;
  const content = data?.en?.schemeContent;

  if (!details?.schemeName) {
    return null;
  }

  const references = content?.references || [];

  return {
    id: data.schemeId || data.slug || details.schemeName,
    name: details.schemeName,
    state: details.state?.label || "Central / Other",
    category: (details.schemeCategory || [])
      .map(item => item.label)
      .join(", "),
    tags: details.tags || [],
    benefit: content?.briefDescription || "",
    eligibility: content?.eligibilityCriteria
      ?.eligibilityDescription_md || "",
    officialLink:
      references.find(item =>
        typeof item.url === "string" &&
        item.url.startsWith("https://")
      )?.url || "",
    source: "myScheme",
    eligibilityVerified: false,
    informationOnly: true
  };
}

// Manual sync: does not run until the API is confirmed working
async function syncSchemes(query = "scholarship") {
  console.log("Starting myScheme sync...");

  const url = new URL(API_URL);

  // Confirm this parameter name in the official API documentation.
  if (query) {
    url.searchParams.set("q", query);
  }

  try {
    const response = await fetchJson(url);
    console.log("API RESPONSE:");
console.log(JSON.stringify(response, null, 2));
    const records = Array.isArray(response)
      ? response
      : response?.data?.schemes ||
        response?.data?.content ||
        response?.schemes ||
        [];

    if (!Array.isArray(records) || records.length === 0) {
      console.log(
        "No scheme list found. Check API response and parameters."
      );
      return { success: false, imported: 0 };
    }

    const existing = readSchemes();
    const merged = new Map();

    for (const scheme of existing) {
      if (scheme?.name) {
        merged.set(scheme.name.toLowerCase(), scheme);
      }
    }

    let imported = 0;

    for (const raw of records) {
      const scheme = normalizeScheme(raw);

      if (!scheme) continue;

      const key = scheme.name.toLowerCase();

      if (!merged.has(key)) imported++;
      merged.set(key, {
        ...merged.get(key),
        ...scheme
      });
    }

    saveSchemes([...merged.values()]);

    console.log(`Sync complete. New schemes: ${imported}`);

    return { success: true, imported };
  } catch (error) {
  console.error("Scheme sync failed:", error);
    return { success: false, imported: 0 };
  }
}

module.exports = { syncSchemes };
