const API_URL = "/api/schemes";

let allSchemes = [];
let currentProfile = null;
let filteredSchemes = [];
let savedSchemes = loadSavedSchemes();

const $ = (selector) => document.querySelector(selector);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function loadSavedSchemes() {
  try {
    return JSON.parse(localStorage.getItem("govscheme-saved") || "[]");
  } catch {
    return [];
  }
}

function saveBookmarks() {
  localStorage.setItem("govscheme-saved", JSON.stringify(savedSchemes));
}

function schemeId(scheme) {
  return String(scheme.id || scheme.name || scheme.title || "");
}

function getSchemeName(scheme) {
  return scheme.name || scheme.title || "Government Scheme";
}

function getSchemeText(scheme) {
  return normalize([
    getSchemeName(scheme),
    scheme.description,
    scheme.summary,
    scheme.benefit,
    scheme.benefits,
    scheme.eligibility,
    scheme.category,
    scheme.state,
    scheme.tags
  ].flat().join(" "));
}

function getBenefits(scheme) {
  const benefits = scheme.benefits ?? scheme.benefit;

  if (Array.isArray(benefits)) {
    return benefits.filter(Boolean).join(", ");
  }

  return benefits || "Benefits depend on the official scheme guidelines.";
}

function getOfficialLink(scheme) {
  const candidates = [
    scheme.officialLink,
    scheme.officialUrl,
    scheme.applyLink,
    scheme.applyUrl,
    scheme.url,
    scheme.link
  ];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.href;
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return "";
}

function getSchemeCoverage(scheme) {
  const rawState = scheme.states ?? scheme.state ?? scheme.coverage ?? "";
  const states = (Array.isArray(rawState) ? rawState : [rawState])
    .map(normalize)
    .filter(Boolean);

  if (
    states.some(state =>
      ["central", "india", "all india", "national"].includes(state)
    )
  ) {
    return "central";
  }

  if (states.length) {
    return "state";
  }

  return "unknown";
}

function matchesSelectedState(scheme, selectedState) {
  if (!selectedState || selectedState === "all") return true;

  const coverage = getSchemeCoverage(scheme);

  if (selectedState === "central") {
    return coverage === "central";
  }

  if (selectedState === "state") {
    return coverage === "state";
  }

  // Central schemes may also be relevant to residents of a state.
  if (coverage === "central") return true;

  const rawState = scheme.states ?? scheme.state ?? scheme.coverage ?? "";
  const states = (Array.isArray(rawState) ? rawState : [rawState])
    .map(normalize);

  return states.includes(normalize(selectedState));
}

const categoryKeywords = {
  education: ["education", "scholarship", "student", "school", "college", "university", "tuition"],
  agriculture: ["agriculture", "farmer", "farming", "crop", "kisan", "irrigation"],
  employment: ["employment", "job", "jobseeker", "skill", "training", "worker", "labour"],
  business: ["business", "entrepreneur", "startup", "loan", "mudra", "self employed"],
  senior: ["senior", "old age", "elderly", "pension"],
  women: ["women", "woman", "girl", "maternity", "mother", "female"],
  disability: ["disability", "disabled", "divyang", "special needs"],
  health: ["health", "medical", "hospital", "insurance", "ayushman"],
  housing: ["housing", "house", "home", "awas", "shelter"],
  general: ["general", "welfare", "ration", "food", "financial assistance", "social security"]
};

function matchesCategory(scheme, category) {
  if (!category || category === "all") return true;

  const schemeCategory = normalize(scheme.category);
  const tags = normalize(Array.isArray(scheme.tags)
    ? scheme.tags.join(" ")
    : scheme.tags || "");

  if (schemeCategory.includes(category) || tags.includes(category)) {
    return true;
  }

  const keywords = categoryKeywords[category] || [category];
  const text = getSchemeText(scheme);

  return keywords.some(keyword => text.includes(normalize(keyword)));
}

function matchesOccupation(scheme, occupation) {
  if (!occupation) return true;

  const occupations = scheme.occupations;

  // If the scheme has no occupation restriction, do not exclude it.
  if (!Array.isArray(occupations) || occupations.length === 0) {
    return true;
  }

  return occupations.some(item => {
    const value = normalize(item);
    return value === "all" ||
      value === "everyone" ||
      value === "general" ||
      value === normalize(occupation);
  });
}

function getEligibilityStatus(scheme, profile) {
  // Never claim confirmed eligibility unless the dataset is verified.
  if (scheme.eligibilityVerified !== true || scheme.informationOnly === true) {
    return {
      label: "Verification Needed",
      className: "status-pending",
      message: "Check the latest official eligibility rules before applying."
    };
  }

  const rules = scheme.rules || scheme;
  const reasons = [];

  if (Number.isFinite(Number(profile.age)) && profile.age !== "") {
    const age = Number(profile.age);

    if (rules.minAge != null && age < Number(rules.minAge)) {
      reasons.push(`Minimum age is ${rules.minAge}.`);
    }

    if (rules.maxAge != null && age > Number(rules.maxAge)) {
      reasons.push(`Maximum age is ${rules.maxAge}.`);
    }
  }

  if (profile.income !== "" && rules.maxIncome != null) {
    if (Number(profile.income) > Number(rules.maxIncome)) {
      reasons.push("Income is above the listed limit.");
    }
  }

  if (profile.marks !== "" && rules.minMarks != null) {
    if (Number(profile.marks) < Number(rules.minMarks)) {
      reasons.push(`Minimum marks required: ${rules.minMarks}%.`);
    }
  }

  if (Array.isArray(rules.categories) && rules.categories.length) {
    if (!rules.categories.map(normalize).includes(normalize(profile.category))) {
      reasons.push("Your category is not in the listed categories.");
    }
  }

  if (Array.isArray(rules.genders) && rules.genders.length) {
    if (!rules.genders.map(normalize).includes(normalize(profile.gender))) {
      reasons.push("The listed gender requirement does not match.");
    }
  }

  if (rules.disabilityRequired === true && !profile.disability) {
    reasons.push("Disability status is required for this scheme.");
  }

  if (reasons.length) {
    return {
      label: "May Not Qualify",
      className: "status-no",
      message: reasons.join(" ")
    };
  }

  return {
    label: "Potential Match",
    className: "status-yes",
    message: "Your details match the available rules. Confirm them on the official website."
  };
}

function readProfile() {
  return {
    state: normalize($("#state")?.value),
    age: $("#age")?.value ?? "",
    occupation: normalize($("#occupation")?.value),
    gender: normalize($("#gender")?.value),
    schemeType: normalize($("#schemeType")?.value || "all"),
    category: normalize($("#category")?.value),
    income: $("#income")?.value ?? "",
    disability: Boolean($("#disability")?.checked),
    academicLevel: normalize($("#academicLevel")?.value),
    marks: $("#marks")?.value ?? ""
  };
}

function updateStudentFields() {
  const studentFields = $("#studentFields");
  const occupation = normalize($("#occupation")?.value);

  if (studentFields) {
    studentFields.style.display = occupation === "student" ? "grid" : "none";
  }
}

function matchesProfile(scheme, profile) {
  if (!matchesSelectedState(scheme, profile.state)) return false;
  if (!matchesOccupation(scheme, profile.occupation)) return false;

  const text = getSchemeText(scheme);

  if (profile.category === "sc" && !text.includes("sc") && !text.includes("scheduled caste")) {
    // Do not exclude schemes without explicit category restrictions.
  }

  if (profile.disability && !text.includes("disability") &&
      !text.includes("disabled") && !text.includes("divyang")) {
    // Disability is a profile detail, not a reason to hide general schemes.
  }

  if (profile.occupation === "student" && profile.academicLevel) {
    const levels = scheme.academicLevels;
    if (Array.isArray(levels) && levels.length &&
        !levels.map(normalize).includes(profile.academicLevel)) {
      return false;
    }
  }

  return true;
}

function renderSchemes(schemes) {
  const container = $("#schemeContainer");
  const count = $("#schemeCount");
  const noResults = $("#noResults");

  if (!container) return;

  if (count) count.textContent = schemes.length;

  if (noResults) {
    noResults.style.display = schemes.length ? "none" : "block";
  }

  if (!schemes.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = schemes.map(scheme => {
    const name = getSchemeName(scheme);
    const status = currentProfile
      ? getEligibilityStatus(scheme, currentProfile)
      : {
          label: "Explore Scheme",
          className: "status-pending",
          message: "Review the official eligibility criteria before applying."
        };

    const description = scheme.description || scheme.summary ||
      "Read the official guidelines to understand this scheme.";

    const coverage = getSchemeCoverage(scheme);
    const coverageLabel = coverage === "central"
      ? "Central Government"
      : coverage === "state"
        ? "State Government"
        : "Coverage not confirmed";

    const tags = Array.isArray(scheme.tags)
      ? scheme.tags
      : scheme.tags
        ? [scheme.tags]
        : [];

    const link = getOfficialLink(scheme);
    const id = schemeId(scheme);
    const isSaved = savedSchemes.includes(id);

    const eligibility = scheme.eligibility || "Check the official portal for eligibility details.";
    const benefits = getBenefits(scheme);

    return `
      <article class="scheme-card">
        <div class="scheme-card-top">
          <span class="scheme-category">${escapeHTML(scheme.category || "General Welfare")}</span>
          <span class="eligibility-status ${escapeHTML(status.className)}">
            ${escapeHTML(status.label)}
          </span>
        </div>

        <h3>${escapeHTML(name)}</h3>

        <p class="scheme-description">${escapeHTML(description)}</p>

        <div class="scheme-details">
          <p><strong>Benefits:</strong> ${escapeHTML(benefits)}</p>
          <p><strong>Eligibility:</strong> ${escapeHTML(eligibility)}</p>
          <p><strong>Coverage:</strong> ${escapeHTML(coverageLabel)}</p>
          ${tags.length
            ? `<p><strong>Tags:</strong> ${tags.map(tag => escapeHTML(tag)).join(", ")}</p>`
            : ""}
        </div>

        <p class="scheme-status-message">${escapeHTML(status.message)}</p>

        <div class="application-guide">
          <strong>How to Apply</strong>
          <ol>
            <li>Open the official website below, if available.</li>
            <li>Read the latest eligibility rules and application dates.</li>
            <li>Keep the required documents ready and follow the portal instructions.</li>
          </ol>
        </div>

        <div class="scheme-card-actions">
          ${link
            ? `<a class="scheme-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">Official Website ↗</a>`
            : `<span class="scheme-link-unavailable">Official link unavailable</span>`}
          <button class="save-button" type="button" data-save-id="${escapeHTML(id)}">
            ${isSaved ? "★ Saved" : "☆ Save"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function applyResultFilters() {
  const search = normalize($("#schemeSearch")?.value);
  const stateFilter = normalize($("#stateFilter")?.value || "all");
  const categoryFilter = normalize($("#schemeFilter")?.value || "all");

  filteredSchemes = allSchemes.filter(scheme => {
    const text = getSchemeText(scheme);

    if (search && !text.includes(search)) return false;

    if (stateFilter === "central" && getSchemeCoverage(scheme) !== "central") {
      return false;
    }

    if (stateFilter === "state" && getSchemeCoverage(scheme) !== "state") {
      return false;
    }

    if (categoryFilter === "eligible") {
      if (!currentProfile) return false;
      const status = getEligibilityStatus(scheme, currentProfile);
      if (status.label !== "Potential Match") return false;
    } else if (!matchesCategory(scheme, categoryFilter)) {
      return false;
    }

    return true;
  });

  renderSchemes(filteredSchemes);
}

function resetFilters() {
  if ($("#schemeSearch")) $("#schemeSearch").value = "";
  if ($("#stateFilter")) $("#stateFilter").value = "all";
  if ($("#schemeFilter")) $("#schemeFilter").value = "all";

  currentProfile = null;
  applyResultFilters();
}

async function loadSchemes() {
  const container = $("#schemeContainer");

  if (container) {
    container.innerHTML = '<p class="loading-message">Loading government schemes...</p>';
  }

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    allSchemes = Array.isArray(data) ? data : data.schemes;

    if (!Array.isArray(allSchemes)) {
      throw new Error("The schemes data format is invalid.");
    }

    applyResultFilters();
  } catch (error) {
    console.error("Could not load schemes:", error);

    if (container) {
      container.innerHTML = `
        <p class="load-error">
          Could not load schemes. Make sure the Node.js server is running,
          then refresh this page.
        </p>
      `;
    }
  }
}

function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");

  const button = $("#darkModeToggle");
  const dark = document.body.classList.contains("dark-mode");

  if (button) {
    button.textContent = dark ? "☀️" : "🌙";
    button.title = dark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", button.title);
  }
}

function handleEligibilitySubmit(event) {
  event.preventDefault();

  const profile = readProfile();

  if (!profile.state || !profile.occupation) {
    alert("Please select your state and occupation.");
    return;
  }

  if (profile.age !== "" && (Number(profile.age) < 0 || Number(profile.age) > 120)) {
    alert("Please enter a valid age.");
    return;
  }

  if (profile.income !== "" && Number(profile.income) < 0) {
    alert("Please enter a valid family income.");
    return;
  }

  if (profile.marks !== "" &&
      (Number(profile.marks) < 0 || Number(profile.marks) > 100)) {
    alert("Please enter marks between 0 and 100.");
    return;
  }

  currentProfile = profile;

  // Keep central schemes and schemes relevant to the selected state.
  const matches = allSchemes.filter(scheme => matchesProfile(scheme, profile));

  filteredSchemes = matches;

  if ($("#schemeSearch")) $("#schemeSearch").value = "";
  if ($("#stateFilter")) $("#stateFilter").value = "all";
  if ($("#schemeFilter")) $("#schemeFilter").value = "all";

  renderSchemes(matches);

  $("#schemes")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleSaveClick(event) {
  const button = event.target.closest("[data-save-id]");
  if (!button) return;

  const id = button.dataset.saveId;
  if (!id) return;

  if (savedSchemes.includes(id)) {
    savedSchemes = savedSchemes.filter(item => item !== id);
  } else {
    savedSchemes.push(id);
  }

  saveBookmarks();
  applyResultFilters();
}

document.addEventListener("DOMContentLoaded", () => {
  const form = $("#eligibilityForm");
  if (form) form.addEventListener("submit", handleEligibilitySubmit);

  $("#occupation")?.addEventListener("change", updateStudentFields);
  $("#schemeSearch")?.addEventListener("input", applyResultFilters);
  $("#stateFilter")?.addEventListener("change", applyResultFilters);
  $("#schemeFilter")?.addEventListener("change", applyResultFilters);

  $("#resetFilters")?.addEventListener("click", resetFilters);
  $("#emptyReset")?.addEventListener("click", resetFilters);
  $("#darkModeToggle")?.addEventListener("click", toggleDarkMode);

  $("#schemeContainer")?.addEventListener("click", handleSaveClick);

  if ($("#year")) {
    $("#year").textContent = new Date().getFullYear();
  }

  updateStudentFields();
  loadSchemes();
});