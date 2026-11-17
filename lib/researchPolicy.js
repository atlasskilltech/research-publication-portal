// Research Promotion Policy, Academic Year 2026–27 — ATLAS SkillTech University.
// Content of the public landing page (app/page.js), taken verbatim from the
// approved policy document (URC & Academic Council). Amounts are display
// strings exactly as printed in the policy (Indian digit grouping).

export const POLICY_META = Object.freeze({
  title: "Research Promotion Policy",
  year: "Academic Year 2026–27",
  effectiveFrom: "1st July 2026",
  approvedBy: "University Research Committee (URC) & Academic Council",
  applicableTo: "Full-Time Faculty Members, ATLAS SkillTech University",
});

export const PREAMBLE = Object.freeze([
  "ATLAS SkillTech University envisions itself as a dynamic hub of innovation, creativity, and knowledge creation. We firmly believe that a robust and vibrant research ecosystem is fundamental to advancing academic excellence, addressing real-world challenges, and contributing meaningfully to society, industry, and the nation. To realise this vision, the University actively nurtures a culture of inquiry by empowering faculty members and scholars to pursue original ideas, foster interdisciplinary collaboration, and generate impactful, outcome-oriented research.",
  "We champion research not merely as an academic obligation, but as a transformative instrument of societal progress and institutional distinction. The University is committed to providing a supportive, enabling environment through progressive institutional policies, structured financial incentives, and comprehensive infrastructural support. Whether a faculty member is publishing in globally recognised journals, filing intellectual property, presenting at international conferences, developing online courses, or leading funded projects — every substantive contribution is acknowledged, rewarded, and celebrated.",
  "The Research Promotion Policy for Academic Year 2026–27 has been reviewed and updated to reflect the University's growing research ambitions and the evolving landscape of higher education. This policy reinforces our commitment to recognising and incentivising faculty efforts in a manner that is fair, transparent, and outcomes-driven.",
]);

export const OBJECTIVES = Object.freeze([
  { title: "Research culture", text: "To foster and sustain a strong, inclusive, and collaborative research culture across all schools, departments, and interdisciplinary clusters within the University." },
  { title: "Quality outputs", text: "To recognise and reward quality academic outputs — including publications in high-impact peer-reviewed journals, patents, copyrights, books, and other creative and intellectual works." },
  { title: "Global engagement", text: "To promote knowledge dissemination, capacity building, and global academic engagement through faculty participation in national and international conferences, FDPs, training programs, and professional bodies." },
  { title: "Professional advancement", text: "To support the continuous professional advancement of faculty members by incentivising the completion of higher academic qualifications and recognised national certification programs." },
  { title: "Knowledge transfer", text: "To facilitate and incentivise knowledge creation and transfer through consultancy services, externally funded research projects, and collaborative industry and government engagements." },
  { title: "Institutional alignment", text: "To align individual faculty research achievements with the broader institutional vision, strategic research priorities, accreditation requirements, and national education policy goals of ATLAS SkillTech University." },
  { title: "Seed funding", text: "To nurture innovative and exploratory research initiatives by providing seed funding to support early-stage, high-potential projects that may not yet qualify for external grants." },
]);

export const INCENTIVE_NOTE =
  "Only Granted Patents and Registered Copyrights qualify for incentive. Filed or Published applications will not be considered.";

// Faculty Rewards and Research Incentives — reward amount per unit.
export const INCENTIVES = Object.freeze([
  {
    key: "patents", title: "Patents and Copyrights", icon: "patent",
    items: [
      ["International Utility / Technical Patent Granted", "₹1,00,000"],
      ["National Utility / Technical Patent Granted", "₹50,000"],
      ["International Design Patent / Copyright Granted", "₹30,000"],
      ["National Design Patent / Copyright Granted", "₹20,000"],
    ],
  },
  {
    key: "publications", title: "Research Publications", icon: "journal",
    items: [
      ["Scopus / WOS Indexed Journal — Impact Factor > 7 or ABDC A* Category / Q1", "₹2,00,000"],
      ["Scopus / WOS Indexed Journal — Impact Factor ≥ 5 < 7 or ABDC A Category / Q2", "₹1,00,000"],
      ["Scopus / WOS Indexed Journal — Impact Factor ≥ 3 < 5 or ABDC B Category / Q3", "₹50,000"],
      ["Scopus / WOS Indexed Journal — Impact Factor ≥ 1 < 3 or ABDC C Category / Q4", "₹25,000"],
      ["Scopus / WOS Indexed Journals (without Impact Factor) / Q4", "₹15,000"],
    ],
  },
  {
    key: "books", title: "Books and Book Chapter Publications", icon: "book",
    items: [
      ["Book Publication with Reputed Publisher — ISBN indexed in Scopus / WOS", "₹50,000"],
      ["Book Publication with Reputed Publisher — ISBN No.", "₹15,000"],
      ["Book Chapter Publication with Reputed Publisher — Scopus Indexed", "₹15,000"],
      ["Book Chapter Publication with Reputed Publisher — ISBN Book", "₹5,000"],
    ],
  },
  {
    key: "consultancy", title: "Consultancy and Funded Projects", icon: "briefcase",
    items: [
      ["Consultancy and Training Services — Generated by University", "30% of fee"],
      ["Consultancy and Training Services — Sourced by Faculty", "70% of fee"],
      ["External Funding Received by University", "5% of grant"],
    ],
  },
  {
    key: "mooc", title: "MOOC Courses and Additional Qualifications", icon: "cap",
    items: [
      ["Additional Qualification Acquired — Ph.D. (Existing Faculty Only)", "₹50,000"],
      ["Additional Qualification — UGC NET (Existing Faculty Only)", "₹20,000"],
      ["MOOC Course Creation for Swayam", "₹20,000"],
      ["MOOC Course Creation for Vidyamitra / Udemy / Any Other Platform", "₹10,000"],
      ["MOOC Course Created by Faculty for Swayam", "50% of grant"],
    ],
  },
]);

export const HIGHLIGHTS = Object.freeze([
  { value: "₹2,00,000", label: "Q1 / ABDC A* journal paper", note: "Scopus / WOS, Impact Factor > 7" },
  { value: "₹1,00,000", label: "International utility patent", note: "Granted patents only" },
  { value: "₹1,50,000", label: "International conference support", note: "Scopus / WOS indexed proceedings" },
  { value: "70%", label: "Consultancy fee share", note: "When sourced by faculty" },
]);

export const CONFERENCE_INTRO =
  "The University provides financial support to eligible faculty for participation in academic events. All applications must be submitted to and approved by the University Research Committee (URC) prior to attending the event.";

export const CONFERENCE_CONDITIONS = Object.freeze([
  "The sanctioned amount includes registration fees, travel, accommodation, ground travel, and food expenses.",
  "Duty leave is granted inclusive of travel dates for the approved activity.",
  "All proposals and claims must be approved by the University Research Committee (URC) prior to availing the benefits.",
  "The funding amount and duty leave entitlements are applicable within a single academic year.",
]);

export const CONFERENCE_SUPPORT = Object.freeze([
  { description: "Membership of Professional Bodies / FDP or Workshop of Minimum 5 Days / UGC Recognised FDPs, Refresher Courses, Induction Program", amount: "₹20,000", leave: "5 Days", scope: "Professional development" },
  { description: "Conferences with Scopus / WOS Indexed Proceedings", amount: "₹20,000", leave: "5 Days", scope: "Conference" },
  { description: "Paper Presentations at Conferences hosted by Institutions of National Eminence such as IITs / IIMs / NITs / Central or State Level Universities", amount: "₹30,000", leave: "5 Days", scope: "National eminence" },
  { description: "Conferences hosted by Prestigious Institutions outside India with Scopus / WOS Indexed Proceedings", amount: "₹1,50,000", leave: "7 Days", scope: "International" },
]);

export const SEED_FUNDING = Object.freeze([
  "To foster a spirit of innovation and inquiry among faculty members, ATLAS SkillTech University offers Seed Funding for early-stage research and development initiatives. This funding is intended to encourage faculty to pursue novel, high-potential ideas that may not yet be eligible for external grants.",
  "By lowering entry barriers and enabling experimentation, this initiative aims to cultivate a vibrant and risk-tolerant research culture, ultimately leading to externally funded projects, impactful publications, and real-world applications.",
]);
export const SEED_USES = Object.freeze(["Pilot studies", "Proof-of-concept work", "Preliminary data collection", "Interdisciplinary collaborations"]);

export const GUIDELINES = Object.freeze([
  "The support is available to full-time faculty members of ATLAS SkillTech University.",
  "If there are multiple contributors, the incentive amount will be equally divided. Incentive is applicable only to ATLAS faculty members.",
  "Faculty must have completed at least one academic semester before applying, unless specifically permitted by University Research Committee.",
  "Faculty must acknowledge ATLAS SkillTech University in all published work and use the official institutional affiliation.",
  "Leave must be pre-approved and should not coincide with key academic responsibilities unless suitable arrangements are made.",
  "Reimbursements are made post-facto upon submission of valid bills and attendance proof.",
  "Maximum funding of ₹1,50,000 will be granted for attending international level high-impact events approved by the University Research Committee.",
  "Maximum funding of ₹30,000 will be granted for attending national level high-impact events approved by the University Research Committee.",
  "Membership reimbursements are valid only for recognised professional bodies.",
  "Each application is subject to review and budget availability.",
  "Events of purely commercial or promotional nature are not eligible for support.",
  "Misuse or misrepresentation of data may lead to withdrawal of support and disciplinary action.",
  "Payments are subject to applicable tax deductions.",
  "Final decision lies with the University Research Committee, and its decision will be binding.",
]);

// How to apply — the Annexure I process described in the policy.
export const APPLY_STEPS = Object.freeze([
  { title: "Apply using Annexure I", text: "Fill in the application for support with your details and the program details, and attach the program brochure and relevant documents." },
  { title: "URC approval first", text: "Submit to the University Research Committee and get approval before attending the event or availing any benefit." },
  { title: "Recommendation & sanction", text: "Recommended by the Director – Centre for Research, Registrar, Pro-Vice Chancellor and Director – HR; sanctioned by the Chief Financial Officer." },
  { title: "Claim post-facto", text: "After the event, submit valid bills and attendance proof. Reimbursement is paid out of the Research & Development budget head." },
]);

export const ANNEXURE_FIELDS = Object.freeze([
  "Name", "Employee ID", "Joining Date", "Academic Year", "Date of Application", "School Name", "Email ID", "Reporting Manager",
  "Name of the Institute", "Date of the Event", "Venue", "Amount of Registration", "Duty Leave (if required)", "Total Requested Support",
]);
