/**
 * Starter policy templates. HR copies one into a draft, edits it in the browser and sends it for CEO approval.
 * They follow common Indian practice and are a starting point, not legal advice. Every {{key}} must be a known placeholder.
 */
export type StarterTemplate = { slug: string; title: string; category: string; summary: string; html: string };

const POSH = `<h1>Policy on Prevention of Sexual Harassment at the Workplace</h1>
<p>{{company.legal_name}} ("the Company") is committed to a workplace where everyone is treated with dignity and respect. This policy is made under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 and its Rules ("the POSH Act").</p>
<h2>1. Who this policy covers</h2>
<p>All employees, interns, trainees, consultants, contractors and visitors at any Company office, at client sites, while travelling for work, at work events and on any digital channel used for work. The Company will not tolerate sexual harassment by anyone, of anyone.</p>
<h2>2. What sexual harassment means</h2>
<p>Any unwelcome act or behaviour, directly or by implication, such as physical contact and advances; a demand or request for sexual favours; sexually coloured remarks; showing pornography; or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature. Implied or explicit promises of preferential treatment, threats of detrimental treatment, interference with work, or creating an intimidating, offensive or hostile environment in connection with such conduct also amount to sexual harassment.</p>
<h2>3. Internal Committee</h2>
<p>The Company has constituted an Internal Committee under section 4 of the POSH Act, for the term from {{posh.ic.term_start}} to {{posh.ic.term_end}}. The Presiding Officer is {{posh.ic.presiding_officer.name}} ({{posh.ic.presiding_officer.email}}). The external member is {{posh.ic.external_member.name}} of {{posh.ic.external_member.organisation}}.</p>
{{posh.ic.members}}
<h2>4. How to raise a complaint</h2>
<p>An aggrieved person may make a written complaint to any member of the Internal Committee within 3 months of the incident, or of the last incident in a series. The Committee may extend this by a further 3 months for good reason. If the person cannot make a written complaint, a Committee member will help them write it.</p>
<h2>5. What happens next</h2>
<ul><li>The Committee may, at the complainant's request, try to settle the matter through conciliation. No monetary settlement can be the basis of conciliation.</li>
<li>Otherwise the Committee will inquire into the complaint, following natural justice, and complete the inquiry within 90 days.</li>
<li>The Committee will share its report and recommendations within 10 days of completing the inquiry. The Company will act on them within 60 days.</li>
<li>During the inquiry the complainant may ask for interim relief, such as a transfer or leave.</li></ul>
<h2>6. Confidentiality and no retaliation</h2>
<p>The identity of the complainant, respondent and witnesses, and the details of the inquiry, are kept confidential. Anyone who victimises a complainant or witness will face disciplinary action. A complaint found to be made with malicious intent may also lead to action; a complaint that cannot be proved is not malicious for that reason alone.</p>
<h2>7. Awareness and reporting</h2>
<p>The Company runs awareness sessions at least once a year and displays the Committee's details at every office. The Committee prepares an annual report under section 21 of the POSH Act.</p>
<p>For questions about this policy, contact {{contacts.hr_contact.name}} ({{contacts.hr_contact.email}}).</p>
<p>Approved for {{company.legal_name}} by {{company.signatory_name}}, {{company.signatory_designation}}.</p>`;

const LEAVE = `<h1>Leave Policy</h1>
<p>This policy explains the leave available to employees of {{company.legal_name}} and how to apply for it. It applies to all full-time employees. Interns and consultants follow the terms of their letters.</p>
<h2>1. Leave types and yearly quota</h2>
{{leave.types}}
<p>Casual leave is {{leave.casual.days}} days a year and sick leave is {{leave.sick.days}} days a year. Quotas run on the calendar year and are pro-rated for people who join or leave during the year.</p>
<h2>2. Applying for leave</h2>
<ul><li>Apply in the HRMS before the leave starts, except for sudden illness or emergencies, when you should apply as soon as you can.</li>
<li>Your manager approves or declines the request in the HRMS. Leave is confirmed only once approved.</li>
<li>Half days can be taken for casual and sick leave.</li></ul>
<h2>3. Sick leave</h2>
<p>For sick leave of more than 2 days in a row, add a short note and, if asked, a medical certificate.</p>
<h2>4. Public holidays</h2>
<p>The holiday calendar for each office is published in the HRMS at the start of the year.</p>
<h2>5. Unpaid leave</h2>
<p>Leave taken beyond your balance, or without approval, is unpaid and is deducted from salary for that month.</p>
<h2>6. Questions</h2>
<p>Contact {{contacts.hr_contact.name}} ({{contacts.hr_contact.email}}).</p>
<p>Approved for {{company.legal_name}} by {{company.signatory_name}}, {{company.signatory_designation}}.</p>`;

export const STARTER_TEMPLATES: StarterTemplate[] = [
  { slug: "posh", title: "Prevention of Sexual Harassment (POSH) Policy", category: "Conduct", summary: "POSH Act policy with the Internal Committee filled in from Configuration", html: POSH },
  { slug: "leave", title: "Leave Policy", category: "People", summary: "Leave types and quotas from the Leave settings", html: LEAVE },
];
