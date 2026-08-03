# Dashboard Issues & Solutions — Action Plan

Real-world use mein admin, sales staff, aur sales manager ke saath jo dikkatein aa sakti hain, unki list aur unhe solve karne ka step-by-step tareeka.

---

## 1. Client (Customer) se juda issues

### 1.1 Duplicate lead ban jaana ✅ Implemented (detection-only, leads abhi mock data hain — see note below)
**Dikkat:** Same customer alag phone number se dobara aaye, ya naam thoda different likha jaye, to system usse naya lead samajh leta hai — history fragment ho jati hai.

**Solve karne ke steps:**
1. Lead lookup ko sirf exact phone match tak seemit na rakho — naam + budget range + preferred project ka fuzzy match bhi add karo.
2. Match milne par ek warning dikhao: "Similar lead exists — merge karein?"
3. Admin/manager ko manual "merge leads" action do jo dono lead ki history ek record mein combine kare.
4. Merge hone par ek activity event log karo (`lead_merged`) — audit ke liye.

**Kya implement hua (2026-08-03):**
- `src/lib/leads.ts` mein `findSimilarLeads()` add kiya — exact match miss hone ke baad phone (last 10 digit, formatting-insensitive) aur naam (near-duplicate/typo, Levenshtein distance ≤2) se possible matches dhoondta hai.
- `SessionStart.tsx` (search screen) par ab "Similar customer already on file — is this one of them?" wala suggestion box dikhta hai, jisme "Use this lead" (existing record reuse karo) aur "This is a different customer" (dismiss) options hain.
- "Use this lead" click hone par `lead_merged` activity event log hota hai (naya `ActivityType`, `SessionReports.tsx` mein "Merged Lead" label ke saath dikhta hai) — audit trail ke liye.
- **Important caveat:** `LEADS` abhi bhi ek hardcoded mock array hai (`src/lib/leads.ts`), koi Postgres `leads` table nahi hai — ye asli CRM/Sperto API integration ka wait kar raha hai. Isliye ye feature abhi **detection + audit-log** tak hi hai; do records ka **real merge/persist** (data combine karke ek row banana) tab hi possible hoga jab leads ek real DB table mein migrate ho jayein.

### 1.2 Customer ka interest track na hona ✅ Implemented
**Dikkat:** Staff sirf free-text notes likhta hai, jo skip bhi ho sakta hai — pata nahi chalta customer serious tha ya nahi.

**Solve karne ke steps:**
1. Session end karne se pehle ek mandatory "Interest Level" selector do: Highly Interested / Neutral / Not Interested / Follow-up Later.
2. "End Session" button tab tak disable rakho jab tak ye select na ho.
3. Free-text note ko optional add-on rakho, mandatory na banao.
4. Reports tab mein interest-level ka breakdown bhi dikhao (kitne % highly interested the).

**Kya implement hua:** `PropertyShowcase.tsx` mein "End Session" click hote hi ek gate-modal khulta hai (4 options: Highly Interested / Neutral / Not Interested / Follow-up Later) — koi option select kiye bina session end nahi hoti. Selection `interest_level` activity event ke roop mein log hoti hai. Admin/Manager Reports tab mein naya "Customer Interest Level" chart add hua.

### 1.3 Privacy / data sensitivity ✅ Implemented
**Dikkat:** Phone number, budget, family size — sab plain data ke roop mein store/dikh raha hai.

**Solve karne ke steps:**
1. Tables mein phone number ko mask karke dikhao (`98xxxxx210`).
2. Full number sirf "reveal" click par dikhe, aur wo click khud ek activity event ban jaye (kisne kab dekha, audit trail ke liye).
3. Data retention policy set karo — X din/mahine baad purane leads auto-archive ho jayein.
4. Agar customer data export/delete request kare, uske liye ek admin-only "delete lead data" action banao.

**Kya implement hua (2026-08-03, retention + delete):**
- Phone number Leads tab mein masked dikhta hai (`98xxxxx210`) — click karke reveal karna padta hai, aur wo click khud `phone_revealed` activity event ke roop mein log hota hai.
- **Retention: 30 din.** Koi naya DB field/cron job nahi chahiye — `leads.created_at` se hi derive hota hai (`isStaleLead()` in `src/lib/leads.ts`). 30+ din purane leads Leads tab mein by default hidden hain ("auto-archive"), lekin delete nahi hote — ek "Show N archived (30+ days old)" checkbox se wapas dikh jaate hain.
- **Delete action:** Admin-only "Delete" button per lead (server-side bhi role-check hai — `requireAdmin()` in `/api/leads/route.ts`, sirf UI-level gate pe depend nahi karta), themed confirm dialog ke saath. Delete karne par lead row permanently DB se hat jati hai, uske linked activity events ka `lead_name` column scrub hota hai, **aur har event ke free-text `label` mein se bhi customer ka naam replace ho jata hai** (jaise "Opened profile for Rohan Mehta" → "Opened profile for [deleted]") — events khud rehte hain (staff accountability record hai, customer ka data nahi) taake audit-trail integrity na tootey. Ek "Customer data deleted" event bhi log hota hai.
- **Verified (2026-08-03):** Real Postgres data pe test kiya — backdated lead pe `isStaleLead()` sahi `true` return karta hai, fresh lead pe `false`; delete ke baad lead row gayab, activity event preserved with `lead_name: null` aur label mein naam `[deleted]` se replace, plus naya audit event.

---

## 2. Sales Staff se juda issues

### 2.1 Login sharing (ek account, multiple log ke istemal) ✅ Implemented
**Dikkat:** Agar 2-3 staff ek hi login use karte hain, to activity tracking bekaar ho jati hai — pata nahi chalta actual mein kaun present kar raha tha.

**Solve karne ke steps:**
1. Login ke waqt device fingerprint/session ID capture karo.
2. "Single active session" rule enforce karo — naya login hone par purana session automatically khatam ho (already `Force Logout` infra maujood hai, bas trigger automatic banana hai).
3. Agar dusra device same account se login kare, purane session ko turant logout karke uska screen par notice dikhao: "logged in from another device".

**Kya implement hua:** Login route ab `staff_controls.current_session_id` mein latest session save karta hai. `KickWatcher` (2s poll, already existing force-logout infra) ab isse bhi check karta hai — mismatch milne par purana device automatically `?replaced=1` notice ke saath sign out ho jata hai.

### 2.2 Fake / inflated activity ✅ Implemented
**Dikkat:** Staff ko pata hai activity track ho rahi hai, to wo random clicks/tab-switches karke apni activity inflate kar sakta hai.

**Solve karne ke steps:**
1. Raw event count ki jagah "meaningful activity" metric banao — jaise unique projects shown + actual customer-interaction duration.
2. Repeated same-action clicks (ek hi tab ko baar-baar khol-band karna) ko duplicate maan kar count na karo.
3. Dashboard mein sirf weighted/deduplicated numbers dikhao, raw click count nahi.

**Kya implement hua:** `distinctShown()` helper — ek hi (type + label) combination ko ek presentation ke andar sirf ek baar count karta hai. Staff Leaderboard, Most-Shown Projects, aur Content Breakdown teeno charts ab isi deduplicated data pe based hain — same tab baar-baar khol-band karne se number inflate nahi hota.

### 2.3 Network/device blame game ✅ Implemented
**Dikkat:** VR tour load nahi hota to staff kehta hai "system slow tha" — verify karna mushkil hai.

**Solve karne ke steps:**
1. Iframe load fail/timeout ko khud ek activity event ki tarah log karo (`vr_load_failed`, timestamp ke saath).
2. Reports mein ek "technical issues" section banao jo har staff/session ke liye failure count dikhaye.
3. Isse verify ho sakega ke staff sach keh raha tha ya avoid kar raha tha.

**Kya implement hua:** VR iframe ke `onError` aur 20s-timeout dono jagah ab `vr_load_failed` activity event log hota hai (pehle sirf silently "loaded" maan liya jata tha). Reports tab mein naya "Technical Issues (VR Load Failures)" chart, per-staff failure count ke saath.

### 2.4 Naye staff ka training gap ✅ Implemented
**Dikkat:** Naya staff jo pehli baar system use kar raha hai, uski activity normal staff jaisi hi track hoti hai — unfair comparison hota hai.

**Solve karne ke steps:**
1. Staff record mein ek "joining date" field rakho.
2. Pehle 30 din ke liye dashboard mein "New Joiner" tag do.
3. Manager ke reports mein naye joiners ko alag benchmark ke saath dikhao, seedha experienced staff se compare na karo.

**Kya implement hua:** `src/lib/users.ts` mein `joiningDate` optional field + `isNewJoiner()` helper add kiya (30 din ki window). Staff Leaderboard aur Staff Activity panel mein naam ke saath "New" badge dikhta hai. **Note:** existing mock staff ke actual joining dates on-file nahi hain — jab real naya staff add ho, `joiningDate` field bhar dena.

### 2.5 Trust/morale issue ✅ Implemented ("mujhe CCTV ki tarah track kiya ja raha hai")
**Dikkat:** Staff ko lage sirf punishment ke liye track ho raha hai, morale down ho sakta hai.

**Solve karne ke steps (process, code nahi):**
1. Onboarding ke waqt clearly explain karo ye system coaching/improvement ke liye hai.
2. Staff ko khud apna data dekhne do — ek "My Activity" self-view page banao (staff apna hi data dekh sake, doosron ka nahi).
3. Reports ko positive framing do — "improvement areas" dikhao, sirf "mistakes" nahi.

**Kya implement hua:** Naya route `/my-activity` (`src/app/my-activity/page.tsx`, `src/components/MyActivity.tsx`) — staff apni hi presentations, session count, aur customers-reached dekh sakta hai (positive stat framing, koi "mistakes" list nahi). `SessionStart` screen se "My Activity" button se pahunch sakte hain. Onboarding messaging process/training ka hissa hai, code se nahi hota.

---

## 3. Sales Manager se juda issues

### 3.1 Numbers manipulate karna ✅ Implemented
**Dikkat:** Manager apni team ki performance ko "adjust" karne ki koshish kar sakta hai (jaise staff ko bolna notes zyada likho taake session lamba dikhe).

**Solve karne ke steps:**
1. Admin ke liye ek cross-manager comparison view banao jisme statistical outliers highlight ho (jaise "is team ka avg session time doosron se 3x zyada hai").
2. Ye automatic anomaly detection ho, manual review ki zarurat na pade shuru mein.
3. Outlier detect hone par admin ko alert/notification bhejo.

**Kya implement hua:** `buildManagerComparison()` — har manager ka avg session time compute karke, agar koi manager sabki median se 2x zyada hai to "Outlier" badge ke saath flag karta hai (automatic, manual review nahi chahiye). Admin Reports tab mein "Cross-Team Session Time Comparison" table. Real-time alert/notification (step 3) skip kiya — abhi koi push-notification infra nahi hai, add karne ke liye ek external service (email/SMS/push) chahiye hoga.

### 3.2 Lead ownership dispute ✅ Implemented
**Dikkat:** Ek lead do managers ki teams ne alag time pe handle kiya — commission/credit ka jhagda ho sakta hai.

**Solve karne ke steps:**
1. Har lead pe explicit "assigned staff/manager" field rakho.
2. Reassignment hone par ek activity event log karo: `lead_reassigned` (kisne, kab, kisse-kisko).
3. Lead history mein ye poora audit trail dikhao — dispute hone par manually trace na karna pade.

**Kya implement hua (2026-08-03):** Leads ko ab real Postgres `leads` table mein migrate kiya (pehle mock array tha) — `scripts/db/schema.sql`, naya `src/app/api/leads/route.ts`. Har lead pe `assignedStaffEmail` field hai. Jab bhi koi staff "Start Session" dabata hai kisi aise lead pe jo pehle se doosre staff ko assigned tha, system automatically `lead_reassigned` activity event log karta hai ("Reassigned from X to Y") — koi manual reassignment UI ki zarurat nahi padi, existing "start session" flow ka hi side-effect hai. `src/lib/leads.ts` ab async API client hai (pehle sync mock array tha).

### 3.3 Block/unblock power ka misuse ✅ Implemented
**Dikkat:** Manager apni team ke liye project block/unblock kar sakta hai — galti se ya jaan-boojh kar presentation ke beech mein customer ke saamne embarrass kar sakta hai.

**Solve karne ke steps:**
1. Block karte waqt reason mandatory karo — dropdown se: Sold Out / Price Change / Under Renovation / Other.
2. Reason ko activity log mein save karo.
3. Admin ke reports mein "block frequency per manager" pattern dikhao — agar koi manager baar-baar bina wajah block kar raha ho to flag ho.

**Kya implement hua:** Block karte waqt ab ek mandatory reason-picker modal khulta hai (Sold Out / Price Change / Under Renovation / Other) — bina reason chune block nahi hota. Reason activity log mein (`status` type event, "blocked by ... — reason: ...") save hota hai, affected staff ki timeline mein dikhta hai. Admin ke Reports tab mein naya "Project Blocks by Team" chart add hua (admin-only view, cross-team pattern ke liye).

### 3.4 Manager ki khud ki accountability measure na ho pana ✅ Implemented
**Dikkat:** Manager khud presentation nahi karta, sirf team ke numbers se judi performance measure hoti hai — manager ka individual contribution clear nahi hota.

**Solve karne ke steps:**
1. Manager-specific metrics banao jo team performance se alag hon — jaise staff issues resolve karne ka average time, training sessions ki count.
2. In metrics ko admin dashboard mein manager-level report ke roop mein add karo.

**Kya implement hua:** Force-logout aur restore-access dono ab activity log mein record hote hain (`status` type event). `buildManagerAccountability()` — har manager ka "avg. time to restore access after a force-logout" compute karta hai. Admin Reports tab mein "Manager Accountability" table — abhi khali dikhega jab tak actual kick/restore cycles na ho (koi historical backfill nahi hai).

### 2.6 Login karke kuch bhi activity na karna (idle staff) ✅ Implemented
**Dikkat:** Staff login kar leta hai lekin kaam kuch nahi karta — abhi dashboard sirf "activity hui to log hoti hai" wala model hai, "activity nahi ho rahi" ko explicitly track nahi karta.

**Solve karne ke steps:**
1. Login ke baad ek "no activity" timer shuru karo — agar X minute (jaise 10-15 min) tak koi activity event (search, project view, session start) na aaye, staff ko "Idle" status mark karo.
2. Staff Activity panel mein already maujood status list (Online/In Meeting/Busy/Offline) mein ek naya state "Idle" add karo.
3. Har staff ke liye "Last Active: X minutes ago" calculation dikhao — agar gap zyada ho (20+ min) jabke login dikha raha ho, to list mein highlight/red-flag karo.
4. Reports tab mein ek "Staff with zero sessions today" section banao — jo staff login hue lekin din bhar mein ek bhi customer session start nahi kiya, unki list alag dikhao.
5. (Advanced/optional) Agar staff X ghante se idle ho to manager ko real-time alert/badge dikhao dashboard pe, taake end-of-day report ka wait na karna pade.

**Implementation ka lazy tareeka:** Naya database field/API call zaroorat nahi — jo login-time aur activity list already store ho rahi hai, usi se derive karo: `lastActivityTime - loginTime > threshold` → "Idle" label.

**Kya implement hua:** `deriveStatus()` mein naya "Idle" state add kiya (5-60 min ka window: >5 min no activity + <60 min = Idle; >60 min ya explicit logout = Offline). Status badge already existing "Online/Busy/Offline" list mein "Idle" bhi dikhta hai. Reports tab mein "Staff With Zero Sessions Today" list add hua.

---

## 4. Dashboard se Sales Kaise Badhega

### 4.1 Jo already ho raha hai usse sales kaise badhega
- **Better follow-up = zyada conversion:** Activity log se pata chalta hai customer ne kya dekha, kitni der dekha, kaunsa project pasand aaya — staff/manager isko follow-up ke liye use kar sakte hain (jaise "aapne X project dekha tha, uska naya offer hai"), jisse cold leads warm ho jati hain.
- **Weak staff ko identify karke train karna:** Reports se pata chalta hai kaunsa staff kam customers convert kar raha hai (low session time, kam projects dikhana) — targeted training se performance improve hoti hai, jo directly sales badhata hai.
- **Popular projects ka pata chalna:** "Most-Shown Projects" chart se pata chalta hai customers kya zyada pasand kar rahe hain — agar koi project bahut dikhaya ja raha hai lekin convert nahi ho raha, to pricing/inventory strategy change ki jaa sakti hai.

### 4.2 Naye features jo directly sales badha sakte hain

**4.2.1 Follow-up reminder system**
- Interest-level tag (section 1.2) ke saath ek automatic reminder banao.
- "Highly Interested" customer ko agar 3 din mein follow-up nahi hua to staff/manager ko alert jaye.
- Cold leads ka sabse bada loss follow-up time pe na hona hota hai — ye directly rokta hai.

**4.2.2 Lead-to-sale conversion tracking ✅ Implemented**
- Abhi dashboard sirf "kitne presentation hue" dikhata hai, "kitne booking/sale mein convert hue" nahi.
- Har lead pe ek final status field add karo: Booked / Lost / In Progress.
- Isse pura funnel dikhega (kitne leads aaye → kitne presentation hue → kitne convert hue) aur pata chalega **kahan leak ho raha hai**.

**Kya implement hua:** Lead ke `leadStatus` mein ab "Booked" aur "Lost" values bhi hain (pehle sirf New/Follow-up/Hot/Negotiation the). Admin/Manager dashboard mein naya "Leads" tab — poori directory dikhta hai (customer, phone, assigned staff, status) aur status ek dropdown se change ho sakta hai. Tab ke top pe Total Leads / Booked / Lost stat row hi funnel visibility deta hai.

**4.2.3 Best-performing pitch pattern identify karna** — *Not implemented*
- Jo staff sabse zyada convert karte hain, unka pattern dekho — kaunsa project pehle dikhate hain, kitni der ruk kar dikhate hain, kaunse features (floor plan/gallery/amenities) zyada use karte hain.
- Us pattern ko baaki staff ke liye "recommended flow" bana do.
- **Kyun skip kiya:** Meaningful pattern nikalne ke liye kaafi sales data chahiye (abhi sirf mock/demo data hai) — real usage ke baad hi ye analysis kaam ka hoga.

**4.2.4 Urgency/scarcity dikhana customer ko** — *Needs a decision*
- Showcase screen pe agar "Only 3 units left" ya "12 people visited this project this week" jaisa real data (agar available ho) dikhaya jaye, to customer pe psychological urgency create hoti hai — direct conversion booster.
- **Kyun skip kiya:** Ye tabhi honest hai jab real inventory/unit-count data ho — abhi properties.ts mein sirf naam/location/link hai, real available-units count nahi. Fake number dikhana misleading hoga customer ke saath.

**4.2.5 Repeat-visit customers ko priority dena ✅ Implemented**
- "Previous Visits" field already leads mein hai — jo customer 2nd/3rd baar aa raha hai, unhe staff ke liye highlight karo: "This customer has visited 2 times before, high intent".
- Staff ko pata chalega ye lead zyada serious hai, extra effort lagayein.
- **Kya implement hua:** `SessionStart.tsx` ke "Customer Found" card mein ab `previousVisits > 0` hone par ek highlighted note dikhta hai: "This customer has visited N times before — high intent."

**4.2.6 WhatsApp/SMS integration se turant follow-up** — *Deferred to Version 2*
- Presentation khatam hone ke turant baad customer ko ek automatic WhatsApp message jaye (jo dikhaya gaya uska summary + brochure link).
- Fresh memory rehte hi ek touchpoint milta hai, jo conversion rate badhata hai.
- **Decision (2026-08-03):** V1 ke scope se bahar — V2 mein add hoga. Iske liye ek real messaging provider (WhatsApp Business API, Twilio, ya koi SMS gateway) integrate karna padega — jab V2 pe kaam shuru ho tab provider choose karke account/API keys set up karna hoga.

**High-impact, kam-effort priority:** Pehle 4.2.2 (conversion tracking) aur 4.2.1 (follow-up reminder) — inse funnel leak point pata chalega aur cold leads warm follow-up se convert hongi.

---

## Status Summary (2026-08-03)

**Implemented:** 2.1, 1.1 (detection-only), 1.2, 3.2, 3.3, 4.2.2, 2.6, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4, 4.2.5, 1.3 (masking + 30-day retention + admin delete).

**Pending — needs a business/product decision, not silently built:**
- 3.1 step 3's real-time alert/notification (needs a push/email/SMS channel).
- 4.2.4 (scarcity display — needs real inventory/unit-count data, not fake numbers).

**Deferred to Version 2 (decided 2026-08-03):**
- 4.2.6 (WhatsApp/SMS follow-up — needs an external messaging provider chosen and set up; out of V1 scope).

**Not implemented — needs real usage data first:**
- 4.2.3 (best-performing pitch pattern — meaningless on mock/demo data).

Side-effect of this pass: **leads migrated from a hardcoded mock array to a real Postgres `leads` table** (`scripts/db/schema.sql`, `src/app/api/leads/route.ts`), which is what made 3.2 and 4.2.2 possible as more than detection-only.
