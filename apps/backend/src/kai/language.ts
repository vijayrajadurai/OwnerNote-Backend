import type { KaiLang } from "./types";

/**
 * Language of the owner's message and the mic's Tamil script read as the Tanglish keywords the rules use.
 * Names are never rewritten here — the name matcher (names.ts) compares them by sound.
 */

const TAMIL_SCRIPT = /[஀-௿]/;

const TANGLISH_MARKERS = new Set([
  "evlo", "evvalavu", "evalo", "iruku", "irukku", "irukka", "irukkaa", "enna", "ennaku", "enakku", "sollu", "solren",
  "venum", "venam", "vendam", "tharanum", "tharanam", "kudukanum", "kudukkanum", "vaanganum", "varanum", "kuduthaan",
  "kuduthan", "kuduthaar", "kuduthaanga", "kuduthen", "koduthen", "kattinaan", "pannu", "pannunga", "panniten",
  "pannitaan", "pannitaru", "kitta", "ku", "oda", "baaki", "baki", "kadan", "inniku", "innikku", "nethu", "naalaiku",
  "yaaru", "yaar", "theriyuma", "sari", "illa", "ille", "aama", "vanakkam", "nandri", "kammi", "theernthu", "podu",
  "ezhuthu", "eluthu", "maasam", "vaaram", "anna", "akka", "thambi", "vaanginen", "vaangiten", "motham", "ethana",
  "ethanai", "nyabagam", "gyabagam", "vechuko", "vachuko", "thappu", "ungaluku", "unaku", "pesu", "la", "le",
  // From the owner's datasets (12 Oct 2026).
  "rooba", "pannunga", "vendiya", "kanakkula", "innum", "enaku", "thara", "podu", "ippo", "konjam", "roobaya", "indha", "naan", "seru",
  "kaattunga", "kudunga", "kitta", "kudukanum", "kudukka", "maasa", "kadantha", "vaara", "oru", "padhivula", "thadava", "vegamaa", "sambandhamaana", "pathina",
  "ner", "irundhu", "iruku", "vara", "baaki", "varanum", "thogaiya", "thayavu", "senju", "seekiram", "muzhusaa", "thelivaaga", "pannanum", "tharala",
  "vaanganum", "kudukala", "baakiyoda", "kooduthalaa", "varavu", "adhigapaduthu", "innaikki", "baakiya", "kootti", "nethaiya", "innaikkiya", "kaalai", "moththa", "maalai",
  "vaarandhira", "maadhaandhira", "sameebathiya", "panna", "thedunga", "panni", "paarunga", "roobaikku", "innaikku", "nethu", "naalaikku", "vaaram", "vandhuchu", "aachu",
  "selavaachu", "kuduthen", "vithen", "vithadhula", "vaanga", "kudutha", "kuduthuten", "thogaiyoda", "kooda", "kuduthuttaaru", "varavula", "baakila", "kattittaaru", "anuppitten",
  "selavula", "pannitten", "potta", "kanakku", "kaatu", "kaattu", "maathu", "padhivai", "pazhayadha", "azhichidu", "panam", "endha", "maasam", "yaar",
  "innaiku", "pudhu", "kadaiyin", "roobai", "maasathoda", "kadaiyila", "sethuko", "vandha", "mattum", "aana", "irukkura", "solla", "mudiyumaa", "pannanumaa",
  "vasool", "selavu", "kadaiku", "laabam", "nashtam", "kaiyila", "sonna", "kudukkanum", "ella", "idhu", "ellaaraiyum", "kuduthutaan", "kudthan", "pottan",
  "potten", "adachitan", "anuppiyaachu", "kattinen", "pannen", "pannan", "thandhutaanga",
]);

/** Tamil words the mic writes → the Tanglish the rules read (owner, 10 Oct 2026: typed and spoken are one Kai). */
const SPOKEN: [string, string][] = [
  ["எவ்வளவு", "evlo"], ["எவ்ளோ", "evlo"], ["எவ்வளோ", "evlo"], ["எவ்ளவு", "evlo"], ["எவளோ", "evlo"],
  ["தரணும்", "tharanum"], ["தரனும்", "tharanum"], ["தரணும", "tharanum"],
  ["கொடுக்கணும்", "kudukanum"], ["குடுக்கணும்", "kudukanum"], ["கொடுக்கனும்", "kudukanum"], ["குடுக்கனும்", "kudukanum"],
  ["வாங்கணும்", "vaanganum"], ["வாங்கனும்", "vaanganum"], ["வரணும்", "varanum"], ["வரனும்", "varanum"],
  ["பாக்கி", "baaki"], ["பேலன்ஸ்", "balance"], ["கடன்", "kadan"], ["கிரெடிட்", "credit"], ["பெண்டிங்", "pending"],
  ["ஸ்டாக்", "stock"], ["இருக்கா", "irukka"], ["இருக்கு", "iruku"], ["எத்தனை", "ethana"],
  ["குடுத்துட்டான்", "kuduthaan"], ["கொடுத்துட்டான்", "kuduthaan"], ["குடுத்தான்", "kuduthaan"], ["கொடுத்தான்", "kuduthaan"],
  ["குடுத்தாரு", "kuduthaar"], ["கொடுத்தார்", "kuduthaar"], ["குடுத்தார்", "kuduthaar"], ["குடுத்தாங்க", "kuduthaanga"],
  ["கொடுத்தாங்க", "kuduthaanga"], ["கட்டினான்", "kattinaan"], ["கட்டிட்டான்", "kattinaan"], ["கட்டினார்", "kattinaan"],
  ["குடுத்தேன்", "kuduthen"], ["கொடுத்தேன்", "kuduthen"], ["குடுத்துட்டேன்", "kuduthen"],
  ["வாங்கினேன்", "vaanginen"], ["வாங்கிட்டேன்", "vaanginen"], ["வாங்குனேன்", "vaanginen"],
  ["இன்னைக்கு", "inniku"], ["இன்னிக்கு", "inniku"], ["இன்று", "inniku"],
  ["கம்மி", "kammi"], ["குறைவு", "kammi"], ["தீர்ந்து", "theernthu"], ["தீர்ந்துபோச்சு", "theernthu"],
  ["வணக்கம்", "vanakkam"], ["நன்றி", "nandri"], ["ஹாய்", "hi"], ["ஹலோ", "hello"],
  ["சரி", "sari"], ["வேண்டாம்", "venam"], ["வேணாம்", "venam"], ["கேன்சல்", "cancel"], ["கன்ஃபர்ம்", "confirm"],
  ["தப்பு", "thappu"], ["தவறு", "thappu"], ["இல்லை", "illa"], ["இல்ல", "illa"],
  ["ஞாபகம்", "nyabagam"], ["வச்சுக்கோ", "vechuko"], ["வெச்சுக்கோ", "vechuko"], ["வைச்சுக்கோ", "vechuko"],
  ["அவங்க", "avanga"], ["அவரு", "avaru"], ["அவர்", "avaru"], ["அவன்", "avan"], ["அவள்", "aval"],
  ["மொத்தம்", "motham"], ["டோட்டல்", "total"], ["யாரு", "yaaru"], ["யார்", "yaaru"], ["கிட்ட", "kitta"],
  ["ரூபாய்", "rupees"], ["ரூபா", "rupees"], ["ஆயிரம்", "aayiram"], ["லட்சம்", "lakh"],
  ["ஓவர்டியூ", "overdue"], ["டியூ", "due"], ["சப்ளையர்", "supplier"], ["கஸ்டமர்", "customer"],
  ["அடுத்த", "next"], ["வாரம்", "vaaram"], ["இங்கிலீஷ்ல", "english-la"], ["இங்கிலீஷ்", "english"],
  ["தமிழ்ல", "tamil-la"], ["தமிழ்", "tamil"], ["பேசு", "pesu"], ["பதில்", "badhil"], ["சொல்லு", "sollu"],
  ["எழுது", "ezhuthu"], ["போடு", "podu"], ["சேர்", "seru"], ["ஆட்", "add"], ["பண்ணு", "pannu"], ["பண்ணுங்க", "pannunga"],
  ["ஜிபே", "gpay"], ["கேஷ்", "cash"], ["பணம்", "panam"], ["காசு", "kaasu"], ["கணக்கு", "kanakku"],
  // Formal Tamil the mic and the owner's dataset use (Kai_100000_Dataset, 12 Oct 2026) — read as the Tanglish words.
  ["வாடிக்கையாளர்", "customer"], ["வாடிக்கையாளரின்", "customer-oda"], ["வாடிக்கையாளருக்கு", "customer-ku"],
  ["வாடிக்கையாளருக்குத்", "customer-ku"], ["வாடிக்கையாளருக்கானது", "customer-ku"], ["வாடிக்கையாளருக்கான", "customer-ku"],
  ["வாடிக்கையாளர்கள்", "customers"], ["வாடிக்கையாளர்களின்", "customers"], ["வாடிக்கையாளர்களைக்", "customers"],
  ["வாடிக்கையாளர்களிடமிருந்து", "customers kitta irundhu"], ["வாடிக்கையாளரைச்", "customer"], ["வாடிக்கையாளரிடமிருந்து", "customer kitta irundhu"],
  ["சப்ளையருக்கு", "supplier-ku"], ["சப்ளையருக்குப்", "supplier-ku"], ["சப்ளையருக்குச்", "supplier-ku"], ["சப்ளையருக்குத்", "supplier-ku"],
  ["சப்ளையருக்குக்", "supplier-ku"], ["சப்ளையருக்கான", "supplier-ku"], ["சப்ளையர்களுக்குக்", "suppliers-ku"], ["சப்ளையர்களுக்குச்", "suppliers-ku"],
  ["சப்ளையர்களின்", "suppliers"], ["சப்ளையர்கள்", "suppliers"], ["சப்ளையரைச்", "supplier"], ["சப்ளையரிடமிருந்து", "supplier kitta irundhu"],
  ["நிலுவை", "pending"], ["நிலுவைத்", "pending"], ["நிலுவைப்", "pending"], ["நிலுவையில்", "pending-la"],
  ["வரவு", "varavu"], ["வரவை", "varavu"], ["வரவுக்கான", "varavu"], ["வரவாகப்", "varavu"],
  ["செலுத்துதல்", "made"], ["செலுத்துதலை", "payment"], ["செலுத்த", "pay"], ["செலுத்திய", "pay panna"], ["செலுத்தியதைப்", "pay pannadhai"],
  ["பண", "cash"], ["பணச்", "payment"], ["பணப்", "payment"], ["பணத்தைச்", "panam"],
  ["ரொக்க", "cash"], ["ரொக்கப்", "cash"], ["ரொக்கத்", "cash"], ["ரொக்கமாகக்", "cash-aa"], ["ரொக்கமாகவா", "cash-aa"],
  ["இருப்பு", "balance"], ["இருப்பை", "balance"], ["இருப்பைக்", "balance"], ["இருப்பைச்", "balance"], ["இருப்பையும்", "balance"],
  ["தொகை", "amount"], ["தொகையை", "amount"], ["தொகையைக்", "amount"], ["தொகையைச்", "amount"], ["தொகையைப்", "amount"],
  ["தொகைகளைக்", "amounts"], ["தொகையில்", "amount-la"], ["தொகைகளை", "amounts"], ["தொகையா", "amount-aa"], ["மொத்தத்", "moththa"],
  ["மொத்த", "moththa"], ["மொத்தக்", "moththa"], ["மொத்தச்", "moththa"],
  ["கணக்குப்", "account"], ["கணக்குச்", "account"], ["கணக்கின்", "account-oda"], ["கணக்கை", "account"], ["கணக்கைத்", "account"],
  ["கணக்கைப்", "account"], ["கணக்கில்", "account-la"], ["கணக்குகளையும்", "accounts"], ["கணக்குடன்", "account-oda"],
  ["பதிவுகள்", "entries"], ["பதிவுகளை", "entries"], ["பதிவுகளைக்", "entries"], ["பதிவுகளையும்", "entries"],
  ["பதிவை", "entry"], ["பதிவைத்", "entry"], ["பதிவைச்", "entry"], ["பதிவில்", "entry-la"], ["பதிவின்", "entry-oda"], ["பதிவுக்குச்", "entry-ku"],
  ["பதிவுக்கான", "entry-ku"], ["பதிவு", "record"], ["செய்யுங்கள்", "pannunga"],
  ["பரிவர்த்தனை", "transaction"], ["பரிவர்த்தனையை", "transaction"], ["பரிவர்த்தனையைக்", "transaction"], ["பரிவர்த்தனைக்கான", "transaction-ku"],
  ["வரலாறு", "history"], ["வரலாற்றைக்", "history"], ["வரலாற்றையும்", "history"], ["லெட்ஜர்", "ledger"], ["லெட்ஜரைத்", "ledger"],
  ["லெட்ஜரில்", "ledger-la"], ["லெட்ஜரை", "ledger"],
  ["பட்டியல்", "list"], ["பட்டியலைக்", "list"], ["பட்டியலை", "list"], ["பட்டியலிடுங்கள்", "list"],
  ["அறிக்கை", "report"], ["அறிக்கையை", "report"], ["அறிக்கையைத்", "report"], ["அறிக்கையைக்", "report"], ["அறிக்கையாகத்", "report-aa"],
  ["சுருக்கத்தைக்", "summary"], ["சுருக்கத்தைத்", "summary"],
  ["விவரம்", "details"], ["விவரத்தை", "details"], ["மாற்றங்களை", "changes"], ["மாற்றங்களின்", "changes"],
  ["விற்பனை", "sales"], ["விற்பனையை", "sales"], ["விற்பனையைப்", "sales"], ["விற்பனைக்கு", "sale-ku"], ["விற்பனைக்கான", "sale-ku"], ["விற்பனையான", "sold"],
  ["கொள்முதல்", "purchase"], ["கொள்முதலை", "purchase"], ["கொள்முதலைப்", "purchase"], ["கொள்முதலுக்கான", "purchase-ku"],
  ["கையிருப்பு", "stock"], ["கையிருப்பைக்", "stock"], ["கையிருப்பைச்", "stock"], ["கையிருப்பைத்", "stock"], ["கையிருப்பின்", "stock-oda"],
  ["கையிருப்பில்", "stock-la"], ["கையிருப்பிலிருந்து", "stock-la irundhu"], ["கையிருப்புள்ள", "stock"], ["கையிருப்பைக்", "stock"],
  ["செலவு", "expense"], ["செலவைக்", "expense"], ["செலவுகளை", "expenses"], ["செலவுகளைக்", "expenses"], ["செலவாகப்", "expense-aa"],
  ["செலவாக", "expense-aa"], ["செலவுத்", "expense"], ["செலவுக்கான", "expense"],
  ["லாப", "profit"], ["லாபம்", "profit"], ["லாபத்தை", "profit"], ["லாபத்தைக்", "profit"],
  ["நஷ்ட", "loss"], ["நஷ்டம்", "loss"], ["வசூல்", "vasool"], ["வசூலைக்", "vasool"], ["வசூலித்த", "collect panna"], ["வசூலாகாத", "collect aagaadha"],
  ["இந்த", "indha"], ["இந்தப்", "indha"], ["இந்தக்", "indha"], ["இந்தச்", "indha"], ["இந்தத்", "indha"],
  ["மாத", "maasa"], ["மாதம்", "maasam"], ["மாதத்தின்", "maasathoda"], ["மாதத்துக்கான", "maasathoda"], ["மாதத்திற்கான", "maasathoda"], ["மாதக்", "maasa"],
  ["கடந்த", "kadantha"], ["வார", "vaara"], ["வாரத்தின்", "vaara"], ["நேர", "ner"], ["காலை", "kaalai"], ["மாலை", "maalai"],
  ["இன்றைய", "innaikki"], ["நேற்றைய", "nethaiya"], ["வாராந்திர", "vaarandhira"], ["மாதாந்திர", "maadhaandhira"],
  ["சமீபத்திய", "sameebathiya"], ["தற்போதைய", "ippo"], ["தற்போது", "ippo"],
  ["முழு", "full"], ["முழுமையாக", "muzhusaa"], ["முழுமையாகத்", "muzhusaa"], ["என்ன", "enna"], ["என்று", "nu"],
  ["தொடர்பான", "sambandhamaana"], ["பற்றிய", "pathina"], ["தனியாக", "separate-aa"], ["தனியாகக்", "separate-aa"],
  ["காட்டுங்கள்", "kaattunga"], ["சரிபார்க்கவும்", "check"], ["தருங்கள்", "kudunga"], ["கணக்கிடுங்கள்", "calculate"],
  ["புதுப்பிக்கவும்", "update"], ["விளக்குங்கள்", "explain"], ["தேடுங்கள்", "thedunga"], ["ஒப்பிட்டுப்", "compare"], ["ஒப்பிடுங்கள்", "compare"],
  ["பாருங்கள்", "paarunga"], ["கொஞ்சம்", "konjam"], ["எனக்கு", "enakku"], ["எனக்குப்", "enakku"], ["எனக்குக்", "enakku"],
  ["என்னிடம்", "enakku"], ["நான்", "naan"], ["தயவுசெய்து", "please"], ["இப்போ", "ippo"], ["சீக்கிரம்", "seekiram"], ["தெளிவாக", "clearly"],
  ["வேண்டிய", "vendiya"], ["வேண்டும்", "venum"], ["கொடுக்க", "kudukka"], ["தர", "thara"], ["கிடைக்க", "vara"], ["வர", "vara"],
  ["கொடுத்தார்", "kuduthaar"], ["மேலும்", "innum"], ["இன்னும்", "innum"], ["சேர்க்கவும்", "add"], ["புதிய", "pudhu"],
  ["உருவாக்கவும்", "create"], ["நீக்கவும்", "delete"], ["நீக்க", "delete"], ["திருத்தவும்", "edit"], ["சரிசெய்யவும்", "correct"],
  ["அனைவரையும்", "ellaaraiyum"], ["அனைத்து", "ella"], ["கடையின்", "kadaiyin"], ["கடையில்", "kadaiyila"], ["கடை", "shop"],
  ["பொருட்களின்", "products"], ["பொருட்களைக்", "products"], ["பொருட்களை", "products"], ["பொருளின்", "product-oda"], ["பொருளைப்", "product"],
  ["குறைந்த", "low"], ["இல்லாத", "illaadha"], ["காலாவதியான", "expiry"], ["தேதி", "date"], ["வங்கி", "bank"], ["வங்கிப்", "bank"],
  ["ரசீதை", "receipt"], ["தள்ளுபடி", "discount"], ["வரித்", "tax"], ["வரி", "tax"], ["விலைப்பட்டியல்", "invoice"], ["விலைப்பட்டியலை", "invoice"],
  ["வாடகையாக", "rent-aa"], ["வாடகையைச்", "rent"], ["சதவீத", "percent"], ["தொகைகளையும்", "amounts"], ["பெற்றதைப்", "petradhai"], ["பெற்றதை", "petradhai"], ["சதவீதம்", "percent"], ["வந்தடைந்த", "vandha"],
  // Everyday Tamil from the owner's second dataset (Kai_Local_Tamil_Thanglish_100000, 12 Oct 2026).
  ["வேகமா", "vegamaa"], ["கணக்குல", "kanakkula"], ["ஒரு", "oru"], ["தடவை", "thadava"], ["பதிவுல", "padhivula"],
  ["ரூபாயை", "roobaya"], ["ரூபாய்க்கு", "roobaikku"], ["ரூபானு", "rooba-nu"], ["இருந்து", "irundhu"], ["செட்டில்", "settle"],
  ["பண்ணணும்", "pannanum"], ["தரல", "tharala"], ["கொடுக்கல", "kudukala"], ["குடுக்கல", "kudukala"], ["பாக்கியோட", "baakiyoda"],
  ["கூடுதலா", "kooduthalaa"], ["வை", "vai"], ["அதிகப்படுத்து", "adhigapaduthu"], ["பாக்கிய", "baakiya"], ["கூட்டி", "kootti"],
  ["ஆச்சு", "aachu"], ["வந்துச்சு", "vandhuchu"], ["செலவாச்சு", "selavaachu"], ["வித்தேன்", "vithen"], ["வித்ததுல", "vithadhula"],
  ["வாங்க", "vaanga"], ["கொடுத்த", "kudutha"], ["குடுத்த", "kudutha"], ["தொகையோட", "amount-oda"], ["கூட", "kooda"],
  ["குடுத்துட்டாரு", "kuduthuttaaru"], ["கொடுத்துட்டாரு", "kuduthuttaaru"], ["வரவுல", "varavula"], ["பாக்கில", "baakila"],
  ["கட்டிட்டாரு", "kattittaaru"], ["அனுப்பிட்டேன்", "anuppitten"], ["செலவுல", "selavula"], ["பண்ணிட்டேன்", "pannitten"],
  ["லிஸ்ட்ல", "list-la"], ["லிஸ்ட்", "list"], ["போட்ட", "potta"], ["காட்டு", "kaattu"], ["மாத்து", "maathu"], ["பழையதை", "pazhayadha"],
  ["பழைய", "pazhaya"], ["அழிச்சிடு", "azhichidu"], ["சேத்துக்கோ", "sethuko"], ["எந்தெந்த", "endha endha"], ["என்னென்ன", "enna enna"],
  ["வியாபாரம்", "viyabaaram"], ["ஆயிரத்துக்கு", "aayirathuku"], ["எல்லா", "ella"], ["சரக்கு", "sarakku"], ["வந்திருக்கா", "vandhirukka"], ["பொருள்", "porul"],
  ["கம்மியா", "kammiya"], ["கடைல", "kadaiyila"], ["கையில", "kaiyila"], ["எடுத்துடு", "eduthudu"], ["என்ட்ரியை", "entry-ai"],
  ["என்ட்ரி", "entry"], ["வேண்டியவங்க", "vendiyavanga"], ["யாரெல்லாம்", "yaar ellam"], ["நிலுவையும்", "pending"], ["ஒண்ணா", "onna"],
  ["வந்த", "vandha"], ["வந்திருக்கு", "vandhiruku"], ["இருந்தா", "irundha"], ["முன்னாடி", "munnaadi"], ["யாருக்கு", "yaaruku"],
  ["யாருக்கான", "yaarukkaana"], ["கடைக்கு", "kadaiku"], ["நேத்து", "nethu"], ["நாளைக்கு", "naalaiku"], ["மாசம்", "maasam"],
  ["கஸ்டமரை", "customer"], ["சப்ளையரை", "supplier"], ["கொடுக்கணும்", "kudukanum"],
  ["கொடுத்தேனா", "kuduthenaa"], ["வந்ததா", "vandhadhaa"], ["வேண்டியதா", "vendiyadhaa"], ["புதுசா", "pudhusaa"], ["புது", "pudhu"],
  ["இது", "idhu"], ["இதை", "idhai"], ["அந்த", "andha"], ["போடணும்", "podanum"], ["இல்லையே", "illaiye"], ["சொல்லவே", "sollave"],
  ["எவ்வளவுனு", "evlo-nu"], ["சொல்லுங்க", "sollunga"], ["சொன்ன", "sonna"], ["பண்ணியிருக்கேன்", "panniyirukken"],
  // How owners say a payment was made (owner-lines.txt of the Android Kai).
  ["குட்தான்", "kudthan"], ["போட்டான்", "pottan"], ["போட்டேன்", "potten"], ["டிரான்ஸ்ஃபர்", "transfer"], ["பண்ணான்", "pannan"],
  ["அனுப்பினாரு", "anuppinaaru"], ["அனுப்பினான்", "anupinaan"], ["பே", "pay"], ["பண்ணேன்", "pannen"], ["அனுப்பியாச்சு", "anuppiyaachu"],
  ["நெஃப்ட்", "neft"], ["ஜிபேல", "gpay-la"], ["ம்ம்", "hmm"], ["தந்துட்டான்", "thandhutaan"], ["தந்துட்டாங்க", "thandhutaanga"],
  ["கட்டினேன்", "kattinen"], ["அடைச்சிட்டான்", "adachitan"],
  // Money in words: "ரெண்டாயிரம்", "ஆயிரத்து ஐநூறு", "மூணு ஆயிரம்".
  ["ஒண்ணு", "onnu"], ["ரெண்டு", "rendu"], ["இரண்டு", "rendu"], ["மூணு", "moonu"], ["மூன்று", "moonu"], ["நாலு", "naalu"],
  ["அஞ்சு", "anju"], ["ஐந்து", "anju"], ["ஆறு", "aaru"], ["ஏழு", "ezhu"], ["எட்டு", "ettu"], ["ஒம்போது", "ombodhu"], ["பத்து", "pathu"],
  ["நூறு", "nooru"], ["இருநூறு", "irunooru"], ["முந்நூறு", "munnooru"], ["நானூறு", "naanooru"], ["ஐநூறு", "ainooru"],
  ["அறுநூறு", "arunooru"], ["எழுநூறு", "ezhunooru"], ["எண்ணூறு", "ennooru"], ["தொள்ளாயிரம்", "thollaayiram"],
  ["ஆயிரத்து", "aayirathu"], ["ரெண்டாயிரம்", "rendaayiram"], ["மூவாயிரம்", "moovaayiram"], ["நாலாயிரம்", "naalaayiram"],
  ["அஞ்சாயிரம்", "anjaayiram"], ["ஐயாயிரம்", "anjaayiram"], ["ஆறாயிரம்", "aaraayiram"], ["ஏழாயிரம்", "ezhaayiram"],
  ["எட்டாயிரம்", "ettaayiram"], ["பத்தாயிரம்", "pathaayiram"],
  // Everyday goods and expenses: words, never a person's name.
  ["அரிசி", "arisi"], ["எண்ணெய்", "ennai"], ["சர்க்கரை", "sarkkarai"], ["சிமெண்ட்", "cement"], ["இரும்பு", "irumbu"], ["கம்பி", "kambi"],
  ["மொபைல்", "mobile"], ["பால்", "paal"], ["காய்கறி", "kaaykari"], ["டீ", "tea"], ["தூள்", "thool"], ["சோப்பு", "soap"],
  ["பிஸ்கட்", "biscuit"], ["மளிகை", "maligai"], ["சாமான்", "saamaan"], ["ஸ்பேர்", "spare"], ["பார்ட்ஸ்", "parts"],
  ["குளிர்பானம்", "cool-drinks"], ["நோட்டு", "notebook"], ["புத்தகம்", "book"],
];

const ENGLISH_MARKERS = new Set([
  "how", "what", "who", "which", "when", "much", "many", "owe", "owes", "paid", "add", "the", "is", "are", "my", "show",
  "tell", "please", "give", "gave", "pay", "yes", "no", "cancel", "thanks", "thank", "hello", "today", "total", "remember",
]);

/**
 * "2", "ok", "Kumar": too short to tell a language. Kai keeps answering in the conversation's language instead of
 * switching to English on a bare number or a name.
 */
export function saysNoLanguage(text: string): boolean {
  if (hasTamilScript(text)) return false;
  const words = text.toLowerCase().split(/[^a-z0-9₹.,]+/).filter(Boolean);
  if (!/[a-z]/i.test(text)) return true;
  return words.length <= 2 && !words.some((w) => ENGLISH_MARKERS.has(w) || TANGLISH_MARKERS.has(w));
}

export function hasTamilScript(text: string): boolean {
  return TAMIL_SCRIPT.test(text);
}

export function detectLang(text: string): KaiLang {
  if (hasTamilScript(text)) return "TAMIL";
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => TANGLISH_MARKERS.has(w)) ? "TANGLISH" : "ENGLISH";
}

const SPOKEN_MAP = new Map(SPOKEN);
/** What the mic may glue onto a keyword: "-ல", "-க்கு", "-ஆ", "-உம்" ("ஸ்டாக்ல", "இருக்கா"). */
const TAMIL_TAILS = ["க்கு", "ுக்கு", "கு", "ல", "ில", "ா", "ும்", "ுமா", "ே"];

/** "-ஐ", "-இல்" the mic / a typist puts after a word ("நிலுவை-ஐ", "விவரம்-இல்"). */
const HYPHEN_TAILS: Record<string, string> = { "ஐ": "ai", "இல்": "la", "ல": "la", "க்கு": "ku", "கு": "ku", "ஆ": "aa" };

function spokenWord(token: string): string | undefined {
  const dash = token.indexOf("-");
  if (dash > 0) {
    const head = spokenWord(token.slice(0, dash));
    const tail = token.slice(dash + 1);
    if (head) return `${head}-${HYPHEN_TAILS[tail] ?? tail}`;
  }
  const exact = SPOKEN_MAP.get(token);
  if (exact) return exact;
  for (const tail of TAMIL_TAILS) {
    if (token.length > tail.length + 1 && token.endsWith(tail)) {
      const base = SPOKEN_MAP.get(token.slice(0, -tail.length));
      if (base) return base;
    }
  }
  return undefined;
}

/**
 * Lower-case Latin text with the mic's Tamil keywords read as Tanglish, word by word (a name that only contains a
 * keyword — "சரிதா" — is left alone). Unknown Tamil words (names, products) stay as they are.
 */
export function normalize(text: string, keepCase = false): string {
  const spoken = text
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const bare = token.replace(/[?!.,]+$/, "");
      const word = hasTamilScript(bare) ? spokenWord(bare) : undefined;
      return word ? word + token.slice(bare.length) : token;
    })
    .join(" ")
    .trim();
  return keepCase ? spoken : spoken.toLowerCase();
}

/** Pick one of three phrasings by the owner's language. */
export function say(lang: KaiLang, words: { ta: string; tl: string; en: string }): string {
  return lang === "TAMIL" ? words.ta : lang === "TANGLISH" ? words.tl : words.en;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function rupees(amount: number): string {
  return `₹${inr.format(Math.round(amount * 100) / 100)}`;
}

export function quantity(value: number): string {
  return inr.format(Math.round(value * 1000) / 1000);
}
