const {
  Client, GatewayIntentBits, EmbedBuilder,
  SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

const { token, clientId } = require('./config.json');

// ─── In-Memory Data Stores ────────────────────────────────────────────────────
const economy       = new Map(); // userId -> { balance, bank, lastDaily, totalWon, totalLost }
const studyData     = new Map();
const afkData       = new Map();
const studyLeaderboard = new Map();
const inventory     = new Map(); // userId -> [{ item, quantity }]
const warnings      = new Map(); // userId -> [{ reason, mod, date }]
const marriages     = new Map(); // userId -> partnerId
const crashPlayers  = new Map(); // userId -> betAmount during crash round
const xpData        = new Map(); // userId -> { xp, level }
let lastDeletedMsg  = null;
let crashRunning    = false;

// ─── Economy Helpers ─────────────────────────────────────────────────────────
function getEconomy(userId) {
  if (!economy.has(userId)) {
    economy.set(userId, { balance: 500, bank: 0, lastDaily: 0, totalWon: 0, totalLost: 0 });
  }
  return economy.get(userId);
}
function addMoney(userId, amount) {
  const e = getEconomy(userId);
  e.balance += amount;
  if (amount > 0) e.totalWon += amount;
  else e.totalLost += Math.abs(amount);
}
function formatMoney(n) { return `💰 **${n.toLocaleString()}** coins`; }

// ─── GIF APIs ────────────────────────────────────────────────────────────────
// nekos.best action map — free, no API key, purpose-built for anime action GIFs
const nekoActionMap = {
  'anime hug': 'hug',
  'anime kiss': 'kiss',
  'anime slap': 'slap',
  'anime poke': 'poke',
  'anime headpat': 'pat',
  'anime crying': 'cry',
  'anime dance': 'dance',
  'anime facepalm': 'facepalm',
  'anime high five': 'highfive',
  'anime bite': 'bite',
  'anime punch': 'punch',
  'anime wave': 'wave',
  'anime cuddle': 'cuddle',
  'uwu owo anime cat': 'nod',
  'anime battle fight': 'kick',
  'anime fight battle': 'kick',
  'anime roast fire burn': 'baka',
  'anime determined motivation': 'thumbsup',
  'anime boop nose': 'poke',
};

async function fetchActionGif(query) {
  try {
    const endpoint = nekoActionMap[query] || 'wave';
    const res = await fetch(`https://nekos.best/api/v2/${endpoint}?amount=1`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data.results?.[0]?.url || null;
  } catch {
    return null;
  }
}

async function fetchGif(query) {
  // For known action queries, use nekos.best
  if (nekoActionMap[query]) return fetchActionGif(query);
  // For general GIF searches, use Tenor anonymous key
  try {
    const res = await fetch(
      `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=LIVDSRZULELA&limit=20&contentfilter=off&media_filter=minimal`
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    const results = data.results;
    if (!results || results.length === 0) throw new Error();
    const r = results[Math.floor(Math.random() * results.length)];
    return r.media?.[0]?.gif?.url || null;
  } catch {
    return null;
  }
}

// ─── Slash Commands ──────────────────────────────────────────────────────────
const commands = [
  // ── ECONOMY ──
  new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance 💰')
    .addUserOption(o => o.setName('user').setDescription('Check someone else\'s balance')),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins 📅'),
  new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly bonus 📆'),
  new SlashCommandBuilder().setName('work').setDescription('Work to earn some coins 💼'),
  new SlashCommandBuilder().setName('crime').setDescription('Commit a crime for risky rewards 🔫'),
  new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins to your bank 🏦')
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to deposit').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw coins from bank 🏦')
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to withdraw').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('give').setDescription('Give coins to someone 🎁')
    .addUserOption(o => o.setName('user').setDescription('User to give coins to').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top richest users 🏆'),
  new SlashCommandBuilder().setName('rob').setDescription('Try to rob someone 🥷')
    .addUserOption(o => o.setName('user').setDescription('Who to rob').setRequired(true)),
  new SlashCommandBuilder().setName('shop').setDescription('Browse the item shop 🛒'),
  new SlashCommandBuilder().setName('buy').setDescription('Buy an item from the shop 🛍️')
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder().setName('inventory').setDescription('View your inventory 🎒'),

  // ── GAMBLING ──
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin 🪙')
    .addStringOption(o => o.setName('choice').setDescription('heads or tails').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine 🎰')
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('dice').setDescription('Roll the dice 🎲')
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('number').setDescription('Guess a number 1-6').setRequired(true).setMinValue(1).setMaxValue(6)),
  new SlashCommandBuilder().setName('rps').setDescription('Rock Paper Scissors for coins ✂️')
    .addStringOption(o => o.setName('choice').setDescription('Your choice').setRequired(true).addChoices({ name: '🪨 Rock', value: 'rock' }, { name: '📄 Paper', value: 'paper' }, { name: '✂️ Scissors', value: 'scissors' }))
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('blackjack').setDescription('Play Blackjack ♠️')
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('crash').setDescription('Join the crash game 📈')
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('highlow').setDescription('Guess if next card is higher or lower 🃏')
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('roulette').setDescription('Spin the roulette wheel 🎡')
    .addStringOption(o => o.setName('bet_on').setDescription('red/black/green/number').setRequired(true))
    .addIntegerOption(o => o.setName('bet').setDescription('How much to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('lottery').setDescription('Buy a lottery ticket 🎟️')
    .addIntegerOption(o => o.setName('tickets').setDescription('How many tickets (10 coins each)').setRequired(true).setMinValue(1).setMaxValue(10)),

  // ── ACTIONS / FUN ──
  new SlashCommandBuilder().setName('hug').setDescription('Hug someone 🤗')
    .addUserOption(o => o.setName('user').setDescription('Who to hug').setRequired(true)),
  new SlashCommandBuilder().setName('kiss').setDescription('Kiss someone 💋')
    .addUserOption(o => o.setName('user').setDescription('Who to kiss').setRequired(true)),
  new SlashCommandBuilder().setName('slap').setDescription('Slap someone 👋')
    .addUserOption(o => o.setName('user').setDescription('Who to slap').setRequired(true)),
  new SlashCommandBuilder().setName('poke').setDescription('Poke someone 👉')
    .addUserOption(o => o.setName('user').setDescription('Who to poke').setRequired(true)),
  new SlashCommandBuilder().setName('pat').setDescription('Pat someone 🫶')
    .addUserOption(o => o.setName('user').setDescription('Who to pat').setRequired(true)),
  new SlashCommandBuilder().setName('cry').setDescription('Express your sadness 😭'),
  new SlashCommandBuilder().setName('dance').setDescription('Show off your moves 💃'),
  new SlashCommandBuilder().setName('facepalm').setDescription('Facepalm 🤦'),
  new SlashCommandBuilder().setName('highfive').setDescription('High five someone 🙌')
    .addUserOption(o => o.setName('user').setDescription('Who to high five').setRequired(true)),
  new SlashCommandBuilder().setName('bite').setDescription('Bite someone 😬')
    .addUserOption(o => o.setName('user').setDescription('Who to bite').setRequired(true)),
  new SlashCommandBuilder().setName('punch').setDescription('Punch someone 🥊')
    .addUserOption(o => o.setName('user').setDescription('Who to punch').setRequired(true)),
  new SlashCommandBuilder().setName('wave').setDescription('Wave at someone 👋')
    .addUserOption(o => o.setName('user').setDescription('Who to wave at')),
  new SlashCommandBuilder().setName('cuddle').setDescription('Cuddle with someone 🥰')
    .addUserOption(o => o.setName('user').setDescription('Who to cuddle').setRequired(true)),
  new SlashCommandBuilder().setName('boop').setDescription('Boop someone on the nose 👃')
    .addUserOption(o => o.setName('user').setDescription('Who to boop').setRequired(true)),
  new SlashCommandBuilder().setName('owo').setDescription('UwU OwO 🐾'),
  new SlashCommandBuilder().setName('kill').setDescription('Kill someone (fictional) ⚔️')
    .addUserOption(o => o.setName('user').setDescription('Who to kill').setRequired(true)),
  new SlashCommandBuilder().setName('fight').setDescription('Challenge someone to a fight 🥊')
    .addUserOption(o => o.setName('user').setDescription('Who to fight').setRequired(true)),
  new SlashCommandBuilder().setName('marry').setDescription('Propose to someone 💍')
    .addUserOption(o => o.setName('user').setDescription('Who to propose to').setRequired(true)),
  new SlashCommandBuilder().setName('divorce').setDescription('Divorce your partner 💔'),

  // ── STUDY ──
  new SlashCommandBuilder().setName('studystart').setDescription('Start a study session 📚')
    .addStringOption(o => o.setName('subject').setDescription('What are you studying?').setRequired(true)),
  new SlashCommandBuilder().setName('studystop').setDescription('End your study session ⏱️'),
  new SlashCommandBuilder().setName('board').setDescription('Study leaderboard 🏆'),
  new SlashCommandBuilder().setName('pomodoro').setDescription('Start a Pomodoro timer 🍅'),

  // ── INFO / UTILITY ──
  new SlashCommandBuilder().setName('userinfo').setDescription('Get info about a user 👤')
    .addUserOption(o => o.setName('user').setDescription('User to inspect')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Get server info 🌐'),
  new SlashCommandBuilder().setName('avatar').setDescription('Get someone\'s avatar 🖼️')
    .addUserOption(o => o.setName('user').setDescription('User\'s avatar')),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency 🏓'),
  new SlashCommandBuilder().setName('afk').setDescription('Set yourself as AFK 😴')
    .addStringOption(o => o.setName('reason').setDescription('Why are you AFK?')),
  new SlashCommandBuilder().setName('snipe').setDescription('Snipe the last deleted message 👁️'),
  new SlashCommandBuilder().setName('poll').setDescription('Create a poll 📊')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption(o => o.setName('option1').setDescription('Option 1').setRequired(true))
    .addStringOption(o => o.setName('option2').setDescription('Option 2').setRequired(true))
    .addStringOption(o => o.setName('option3').setDescription('Option 3 (optional)'))
    .addStringOption(o => o.setName('option4').setDescription('Option 4 (optional)')),
  new SlashCommandBuilder().setName('calculate').setDescription('Quick calculator 🧮')
    .addStringOption(o => o.setName('expression').setDescription('Math expression').setRequired(true)),
  new SlashCommandBuilder().setName('remind').setDescription('Set a reminder ⏰')
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes from now').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('message').setDescription('What to remind you about').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('See your XP rank 🌟')
    .addUserOption(o => o.setName('user').setDescription('Check someone else\'s rank')),
  new SlashCommandBuilder().setName('xpleaderboard').setDescription('XP leaderboard 🌟'),

  // ── MOD ──
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member 👢')
    .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member 🔨')
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member 🔇')
    .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member ⚠️')
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('warnings').setDescription('Check someone\'s warnings ⚠️')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('clearwarns').setDescription('Clear all warnings for a user ✅')
    .addUserOption(o => o.setName('user').setDescription('User to clear').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages 🗑️')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode 🐢')
    .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode seconds (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('lock').setDescription('Lock a channel 🔒')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock a channel 🔓')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement 📢')
    .addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to send in'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── FUN / MISC ──
  new SlashCommandBuilder().setName('meme').setDescription('Get a random meme 😭'),
  new SlashCommandBuilder().setName('gif').setDescription('Search for a GIF 🎥')
    .addStringOption(o => o.setName('query').setDescription('What GIF to search').setRequired(true)),
  new SlashCommandBuilder().setName('motivation').setDescription('Get a motivational quote ✨'),
  new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball 🎱')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),
  new SlashCommandBuilder().setName('roast').setDescription('Get roasted 🔥')
    .addUserOption(o => o.setName('user').setDescription('Roast someone else')),
  new SlashCommandBuilder().setName('rizz').setDescription('Get a rizz line 💘'),
  new SlashCommandBuilder().setName('funphrase').setDescription('Random funny phrase 😂'),
  new SlashCommandBuilder().setName('joke').setDescription('Tell a random joke 😄'),
  new SlashCommandBuilder().setName('fact').setDescription('Random interesting fact 🧠'),
  new SlashCommandBuilder().setName('ship').setDescription('Ship two users ❤️')
    .addUserOption(o => o.setName('user1').setDescription('First user').setRequired(true))
    .addUserOption(o => o.setName('user2').setDescription('Second user').setRequired(true)),
  new SlashCommandBuilder().setName('pp').setDescription('Check PP size 🍆')
    .addUserOption(o => o.setName('user').setDescription('Who to check')),
  new SlashCommandBuilder().setName('iq').setDescription('Check someone\'s IQ 🧠')
    .addUserOption(o => o.setName('user').setDescription('Who to check')),
  new SlashCommandBuilder().setName('simp').setDescription('Simp rating 🥺')
    .addUserOption(o => o.setName('user').setDescription('Who to rate')),
  new SlashCommandBuilder().setName('clap').setDescription('Add clap emojis to text 👏')
    .addStringOption(o => o.setName('text').setDescription('Your text').setRequired(true)),
  new SlashCommandBuilder().setName('reverse').setDescription('Reverse your text 🔄')
    .addStringOption(o => o.setName('text').setDescription('Text to reverse').setRequired(true)),
  new SlashCommandBuilder().setName('say').setDescription('Make the bot say something 📢')
    .addStringOption(o => o.setName('message').setDescription('What to say').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('topic').setDescription('Random conversation topic 💬'),
  new SlashCommandBuilder().setName('wyr').setDescription('Would you rather? 🤔'),
  new SlashCommandBuilder().setName('neverhaveiever').setDescription('Never have I ever... 🍻'),
  new SlashCommandBuilder().setName('help').setDescription('See all commands 🌙'),
].map(c => c.toJSON());

// ─── Register ────────────────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(token);
(async () => {
  try {
    console.log('🌙 All Nighter: Registering GLOBAL slash commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Global commands registered! (may take up to 1 hour to appear in all servers)');
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
})();

// ─── Static Data ─────────────────────────────────────────────────────────────
const shopItems = [
  { name: 'VIP Badge', price: 500, emoji: '👑', description: 'Flex your VIP status' },
  { name: 'Lucky Charm', price: 200, emoji: '🍀', description: '+10% gambling luck' },
  { name: 'Shield', price: 300, emoji: '🛡️', description: 'Protects from robbery' },
  { name: 'Fishing Rod', price: 150, emoji: '🎣', description: 'Use /fish to earn coins' },
  { name: 'Briefcase', price: 400, emoji: '💼', description: 'Better /work payouts' },
  { name: 'Padlock', price: 250, emoji: '🔒', description: 'Double bank security' },
];

const memes = [
  "POV: It's 2 AM, exam is tomorrow, and you're on Discord 💀",
  "Teacher: 'This won't come in the exam'\n*It comes in the exam* 😭",
  "Me: I'll study after this video. 5 hours later: 👁️👄👁️",
  "Opening the textbook be like: *opens* *closes* *cries*",
  "Why is the syllabus literally infinite 😭",
  "Study: 0% | Short videos: 100% | Coping: Activated 😅",
  "'I'll definitely study tomorrow' — said every day for 3 months 🗿",
  "When you study 5 mins before the exam and somehow pass 💅",
];

const motivations = [
  "You can do this. Just start. 🔥",
  "One good study session matters more than a week of excuses. 📚",
  "Every expert was once a total beginner. Keep going. 💪",
  "Your future self is watching. Don't disappoint them. 🌙",
  "Hard work beats talent when talent doesn't work hard. 🏆",
];

const jokes = [
  ["Why did the scarecrow win an award?", "Because he was outstanding in his field! 😂"],
  ["What do you call a fish without eyes?", "A fsh! 🐟"],
  ["Why don't scientists trust atoms?", "Because they make up everything! ⚛️"],
  ["What's brown and sticky?", "A stick! 🪵"],
  ["Why can't you explain puns to kleptomaniacs?", "They always take things literally! 😂"],
  ["I told a joke about paper. It was tearable.", "😭"],
  ["What do you call cheese that isn't yours?", "Nacho cheese! 🧀"],
];

const facts = [
  "Honey never spoils. Archaeologists found 3000-year-old honey in Egyptian tombs still edible! 🍯",
  "A group of flamingos is called a 'flamboyance'. 🦩",
  "The sun is about 4.6 billion years old and is halfway through its life. ☀️",
  "Octopuses have three hearts and blue blood. 🐙",
  "Bananas are slightly radioactive due to their potassium content. 🍌",
  "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid. 🏛️",
  "A day on Venus is longer than a year on Venus. 🪐",
];

const topics = [
  "If you could have any superpower but it only works on Tuesdays, what would it be?",
  "What's a food combination that sounds disgusting but is actually amazing?",
  "If animals could talk, which one would be the most annoying?",
  "What's the most useless talent you have?",
  "If you could un-invent one thing, what would it be?",
  "What's something you're irrationally scared of?",
  "If your life was a movie genre, what genre would it be?",
];

const wyrQuestions = [
  "Would you rather be invisible OR be able to fly?",
  "Would you rather only be able to whisper OR only be able to shout?",
  "Would you rather have no internet for a month OR no food for a week?",
  "Would you rather know how you die OR know when you die?",
  "Would you rather be 10 minutes late to everything OR 20 minutes early to everything?",
];

const nhiQuestions = [
  "Never have I ever stayed up for 48 hours straight 😴",
  "Never have I ever sent a risky text to the wrong person 💀",
  "Never have I ever pretended to be busy to avoid someone 🙃",
  "Never have I ever cried at a movie 😭",
  "Never have I ever faked being sick to skip something 🤒",
  "Never have I ever eaten food that fell on the floor 😬",
  "Never have I ever laughed so hard I cried 😂",
];

const roasts = [
  "You'd win gold at the Procrastination Olympics 🥇",
  "Your study routine makes teachers cry in private 💀",
  "Even the WiFi works harder than you do 💀",
  "Your notebook is so clean it belongs in a museum 💅",
  "Your brain cells have a better social life than you 😭",
  "You're the human equivalent of a participation trophy 🏅",
  "If laziness was a sport, you'd be a world champion 😂",
];

const rizzLines = [
  "Are you an exam? Because I've been thinking about you all night 😏",
  "Are you Physics? Because I can't stop being attracted to you ⚛️",
  "You're the answer key I never had 💘",
  "Your smile does more damage than a surprise quiz 🌸",
  "Are you extra credit? Because you're way more than I expected 👑",
];

const funPhrases = [
  "Please sir, just one more chance 🙏😭",
  "Is this chapter important? No? *skips* 😅",
  "In the exam hall: Wait, did we study this?? 💀",
  "What's your attendance? Mine is... let's not talk about it 😭",
];

const eightBallResponses = [
  "Yes, absolutely! ✅", "Nope, not happening 💀", "Possible... 🤔",
  "Looking bright! ✨", "Try again later ⏳", "Signs point to yes 🎱",
  "Outlook not so good 😬", "Without a doubt! 💯", "Very doubtful 🙃",
  "Ask again after studying 📚", "My sources say no 💀",
];

const killMethods = [
  "challenged to a one-on-one duel", "obliterated with a finishing move",
  "yeeted into the shadow realm", "defeated in an epic rap battle",
  "destroyed in a staring contest", "eliminated in a meme competition",
  "banished by the power of friendship", "defeated by the power of stonks 📈",
];

const fightOutcomes = [
  "after landing a devastating combo", "by using the forbidden technique",
  "by pulling off a counter-attack", "by deploying a tactical meme",
  "using sheer willpower and anime energy", "by unlocking their inner beast",
];

const workJobs = [
  { job: "delivered pizzas 🍕", min: 100, max: 300 },
  { job: "coded all night 💻", min: 200, max: 500 },
  { job: "streamed on Twitch 🎮", min: 50, max: 800 },
  { job: "walked dogs 🐕", min: 80, max: 200 },
  { job: "freelanced as a designer 🎨", min: 150, max: 450 },
  { job: "drove for Uber 🚗", min: 120, max: 350 },
  { job: "sold memes online 😭", min: 10, max: 1000 },
];

const crimeAttempts = [
  { act: "robbed a bank 🏦", successRate: 0.4, min: 300, max: 800, fine: 200 },
  { act: "pickpocketed a tourist 👜", successRate: 0.6, min: 100, max: 300, fine: 100 },
  { act: "scammed someone on eBay 📦", successRate: 0.5, min: 200, max: 600, fine: 150 },
  { act: "hacked into a WiFi network 🖥️", successRate: 0.45, min: 250, max: 700, fine: 180 },
  { act: "smuggled exotic spices 🌶️", successRate: 0.55, min: 150, max: 400, fine: 120 },
];

// ─── XP Helpers ──────────────────────────────────────────────────────────────
function getXP(userId) {
  if (!xpData.has(userId)) xpData.set(userId, { xp: 0, level: 1 });
  return xpData.get(userId);
}
function addXP(userId, amount) {
  const d = getXP(userId);
  d.xp += amount;
  const xpNeeded = d.level * 100;
  if (d.xp >= xpNeeded) { d.xp -= xpNeeded; d.level++; return true; }
  return false;
}
function xpBar(xp, level) {
  const needed = level * 100;
  const filled = Math.floor((xp / needed) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` (${xp}/${needed})`;
}

// ─── Card Helper ─────────────────────────────────────────────────────────────
const cardValues = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const cardSuits  = ['♠','♥','♦','♣'];
function randomCard() {
  const v = cardValues[Math.floor(Math.random() * cardValues.length)];
  const s = cardSuits[Math.floor(Math.random() * cardSuits.length)];
  return { display: `${v}${s}`, value: v === 'A' ? 11 : ['J','Q','K'].includes(v) ? 10 : parseInt(v) };
}
function handTotal(hand) {
  let total = hand.reduce((a, c) => a + c.value, 0);
  let aces = hand.filter(c => c.display.startsWith('A')).length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// ─── Action GIF Helper ────────────────────────────────────────────────────────
async function actionEmbed(interaction, query, title, color) {
  await interaction.deferReply();
  let gifUrl = null;
  // If it's a nekos.best action key, fetch directly
  if (nekoActionMap[query]) {
    try {
      const endpoint = nekoActionMap[query];
      const res = await fetch(`https://nekos.best/api/v2/${endpoint}?amount=1`);
      if (res.ok) {
        const data = await res.json();
        gifUrl = data.results?.[0]?.url || null;
      }
    } catch {}
  } else {
    gifUrl = await fetchGif(query);
  }
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: 'All Nighter Bot 🌙' });
  if (gifUrl) embed.setImage(gifUrl);
  else embed.setDescription('*(GIF unavailable)*');
  await interaction.editReply({ embeds: [embed] });
}

// ─── Ready ───────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`🌙 All Nighter is online as ${client.user.tag}!`);
  const activities = [
    '💰 Gambling | /coinflip',
    '📚 Studying | /studystart',
    '🎰 Slots | /slots',
    '💀 Crimes | /crime',
  ];
  let i = 0;
  setInterval(() => {
    client.user.setActivity(activities[i++ % activities.length], { type: 0 });
  }, 10000);
});

// ─── AFK + XP on message ─────────────────────────────────────────────────────
client.on('messageCreate', msg => {
  if (msg.author.bot) return;
  addXP(msg.author.id, 5);
  if (afkData.has(msg.author.id)) {
    afkData.delete(msg.author.id);
    msg.reply(`👋 Welcome back <@${msg.author.id}>! AFK removed.`).then(m => setTimeout(() => m.delete(), 5000)).catch(() => {});
  }
  msg.mentions.users.forEach(user => {
    if (afkData.has(user.id)) {
      msg.reply(`😴 <@${user.id}> is AFK: **${afkData.get(user.id)}**`);
    }
  });
});

client.on('messageDelete', msg => {
  if (!msg.author?.bot) lastDeletedMsg = msg;
});

// ─── Interaction Handler ──────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;

  // ══ ECONOMY ══════════════════════════════════════════════════════
  if (commandName === 'balance') {
    const target = interaction.options.getUser('user') || user;
    const e = getEconomy(target.id);
    const embed = new EmbedBuilder()
      .setColor('#FFD700').setTitle(`💰 ${target.username}'s Wallet`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: '👛 Wallet', value: `${e.balance.toLocaleString()} coins`, inline: true },
        { name: '🏦 Bank', value: `${e.bank.toLocaleString()} coins`, inline: true },
        { name: '💎 Total Net Worth', value: `${(e.balance + e.bank).toLocaleString()} coins`, inline: true },
        { name: '📈 Total Won', value: `${e.totalWon.toLocaleString()} coins`, inline: true },
        { name: '📉 Total Lost', value: `${e.totalLost.toLocaleString()} coins`, inline: true },
      )
      .setFooter({ text: 'All Nighter Economy 💰' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'daily') {
    const e = getEconomy(user.id);
    const now = Date.now();
    const cooldown = 24 * 60 * 60 * 1000;
    if (now - e.lastDaily < cooldown) {
      const remaining = cooldown - (now - e.lastDaily);
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      return interaction.reply({ content: `⏳ Daily already claimed! Come back in **${hrs}h ${mins}m**.`, ephemeral: true });
    }
    const streak = e.dailyStreak ? e.dailyStreak + 1 : 1;
    const bonus = Math.min(streak * 50, 500);
    const reward = 200 + bonus;
    e.balance += reward;
    e.lastDaily = now;
    e.dailyStreak = streak;
    const embed = new EmbedBuilder()
      .setColor('#57F287').setTitle('📅 Daily Reward Claimed!')
      .setDescription(`You received **${reward.toLocaleString()} coins**!\n🔥 Streak: **${streak} days** (+${bonus} bonus)\n\nNew balance: **${e.balance.toLocaleString()} coins**`)
      .setFooter({ text: 'Come back tomorrow for more! 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'weekly') {
    const e = getEconomy(user.id);
    const now = Date.now();
    const cooldown = 7 * 24 * 60 * 60 * 1000;
    if (now - (e.lastWeekly || 0) < cooldown) {
      const remaining = cooldown - (now - (e.lastWeekly || 0));
      const days = Math.floor(remaining / 86400000);
      const hrs = Math.floor((remaining % 86400000) / 3600000);
      return interaction.reply({ content: `⏳ Weekly already claimed! Come back in **${days}d ${hrs}h**.`, ephemeral: true });
    }
    const reward = 2000;
    e.balance += reward;
    e.lastWeekly = now;
    const embed = new EmbedBuilder()
      .setColor('#EB459E').setTitle('📆 Weekly Reward!')
      .setDescription(`You received **${reward.toLocaleString()} coins**!\nNew balance: **${e.balance.toLocaleString()} coins**`)
      .setFooter({ text: 'Come back next week! 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'work') {
    const e = getEconomy(user.id);
    const now = Date.now();
    const cooldown = 60 * 60 * 1000;
    if (now - (e.lastWork || 0) < cooldown) {
      const remaining = cooldown - (now - (e.lastWork || 0));
      const mins = Math.floor(remaining / 60000);
      return interaction.reply({ content: `⏳ You're tired from working! Rest for **${mins} minutes**.`, ephemeral: true });
    }
    const job = workJobs[Math.floor(Math.random() * workJobs.length)];
    const hasBriefcase = (inventory.get(user.id) || []).some(i => i.item === 'Briefcase');
    const multiplier = hasBriefcase ? 1.5 : 1;
    const earned = Math.floor((Math.random() * (job.max - job.min) + job.min) * multiplier);
    e.balance += earned;
    e.lastWork = now;
    const embed = new EmbedBuilder()
      .setColor('#5865F2').setTitle('💼 Work Complete!')
      .setDescription(`You ${job.job} and earned **${earned.toLocaleString()} coins**!\n${hasBriefcase ? '🗃️ Briefcase bonus applied!' : ''}\nBalance: **${e.balance.toLocaleString()} coins**`)
      .setFooter({ text: 'Work again in 1 hour | All Nighter 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'crime') {
    const e = getEconomy(user.id);
    const now = Date.now();
    const cooldown = 90 * 60 * 1000;
    if (now - (e.lastCrime || 0) < cooldown) {
      const remaining = cooldown - (now - (e.lastCrime || 0));
      const mins = Math.floor(remaining / 60000);
      return interaction.reply({ content: `⏳ Lay low for **${mins} more minutes** before committing another crime.`, ephemeral: true });
    }
    const crime = crimeAttempts[Math.floor(Math.random() * crimeAttempts.length)];
    e.lastCrime = now;
    if (Math.random() < crime.successRate) {
      const earned = Math.floor(Math.random() * (crime.max - crime.min) + crime.min);
      e.balance += earned;
      const embed = new EmbedBuilder()
        .setColor('#ED4245').setTitle('🔫 Crime Successful!')
        .setDescription(`You ${crime.act} and got away with **${earned.toLocaleString()} coins**! 😈\nBalance: **${e.balance.toLocaleString()} coins**`)
        .setFooter({ text: 'Crime pays... sometimes. | All Nighter' }).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } else {
      e.balance = Math.max(0, e.balance - crime.fine);
      const embed = new EmbedBuilder()
        .setColor('#2B2D31').setTitle('🚔 Caught by the Cops!')
        .setDescription(`You tried to ${crime.act} but got caught! 😭\nFined **${crime.fine.toLocaleString()} coins**.\nBalance: **${e.balance.toLocaleString()} coins**`)
        .setFooter({ text: 'Should\'ve been sneakier | All Nighter' }).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
  }

  else if (commandName === 'deposit') {
    const amount = interaction.options.getInteger('amount');
    const e = getEconomy(user.id);
    if (e.balance < amount) return interaction.reply({ content: `❌ You only have **${e.balance}** coins in your wallet!`, ephemeral: true });
    e.balance -= amount; e.bank += amount;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('🏦 Deposited!').setDescription(`Deposited **${amount.toLocaleString()} coins** to bank.\nWallet: ${e.balance.toLocaleString()} | Bank: ${e.bank.toLocaleString()}`)] });
  }

  else if (commandName === 'withdraw') {
    const amount = interaction.options.getInteger('amount');
    const e = getEconomy(user.id);
    if (e.bank < amount) return interaction.reply({ content: `❌ You only have **${e.bank}** coins in your bank!`, ephemeral: true });
    e.bank -= amount; e.balance += amount;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('🏦 Withdrawn!').setDescription(`Withdrew **${amount.toLocaleString()} coins** to wallet.\nWallet: ${e.balance.toLocaleString()} | Bank: ${e.bank.toLocaleString()}`)] });
  }

  else if (commandName === 'give') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    if (target.id === user.id) return interaction.reply({ content: '❌ You can\'t give coins to yourself!', ephemeral: true });
    const sender = getEconomy(user.id);
    if (sender.balance < amount) return interaction.reply({ content: `❌ You only have **${sender.balance}** coins!`, ephemeral: true });
    sender.balance -= amount;
    getEconomy(target.id).balance += amount;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#EB459E').setTitle('🎁 Gift Sent!').setDescription(`<@${user.id}> gifted **${amount.toLocaleString()} coins** to <@${target.id}>! 🎉`)] });
  }

  else if (commandName === 'leaderboard') {
    const sorted = [...economy.entries()].map(([id, e]) => ({ id, total: e.balance + e.bank })).sort((a, b) => b.total - a.total).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const desc = sorted.length === 0 ? 'No data yet!' : sorted.map((e, i) => `${medals[i] || `**${i + 1}.**`} <@${e.id}> — **${e.total.toLocaleString()} coins**`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Richest Users').setDescription(desc).setTimestamp()] });
  }

  else if (commandName === 'rob') {
    const target = interaction.options.getUser('user');
    if (target.id === user.id) return interaction.reply({ content: '❌ You can\'t rob yourself!', ephemeral: true });
    const robber = getEconomy(user.id);
    const victim = getEconomy(target.id);
    const now = Date.now();
    if (now - (robber.lastRob || 0) < 30 * 60 * 1000) {
      const mins = Math.floor((30 * 60 * 1000 - (now - (robber.lastRob || 0))) / 60000);
      return interaction.reply({ content: `⏳ You need to wait **${mins} more minutes** before robbing again.`, ephemeral: true });
    }
    if (victim.balance < 100) return interaction.reply({ content: `❌ <@${target.id}> is too broke to rob! 💀`, ephemeral: true });
    const hasShield = (inventory.get(target.id) || []).some(i => i.item === 'Shield');
    if (hasShield) return interaction.reply({ content: `🛡️ <@${target.id}> has a Shield equipped! The robbery failed and your identity was exposed!` });
    robber.lastRob = now;
    if (Math.random() < 0.5) {
      const stolen = Math.floor(victim.balance * (Math.random() * 0.3 + 0.1));
      victim.balance -= stolen; robber.balance += stolen;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('🥷 Robbery Successful!').setDescription(`<@${user.id}> robbed **${stolen.toLocaleString()} coins** from <@${target.id}>! 😈`)] });
    } else {
      const fine = Math.floor(robber.balance * 0.15);
      robber.balance = Math.max(0, robber.balance - fine);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor('#2B2D31').setTitle('🚔 Robbery Failed!').setDescription(`<@${user.id}> tried to rob <@${target.id}> but got caught! Lost **${fine.toLocaleString()} coins** as fine.`)] });
    }
  }

  else if (commandName === 'shop') {
    const desc = shopItems.map(i => `${i.emoji} **${i.name}** — ${i.price} coins\n> ${i.description}`).join('\n\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('🛒 Item Shop').setDescription(desc).setFooter({ text: 'Use /buy <item name> to purchase!' })] });
  }

  else if (commandName === 'buy') {
    const itemName = interaction.options.getString('item').toLowerCase();
    const item = shopItems.find(i => i.name.toLowerCase() === itemName);
    if (!item) return interaction.reply({ content: `❌ Item not found! Use /shop to see available items.`, ephemeral: true });
    const e = getEconomy(user.id);
    if (e.balance < item.price) return interaction.reply({ content: `❌ You need **${item.price}** coins but only have **${e.balance}**!`, ephemeral: true });
    e.balance -= item.price;
    const inv = inventory.get(user.id) || [];
    const existing = inv.find(i => i.item === item.name);
    if (existing) existing.quantity++;
    else inv.push({ item: item.name, emoji: item.emoji, quantity: 1 });
    inventory.set(user.id, inv);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Purchase Successful!').setDescription(`${item.emoji} You bought **${item.name}** for **${item.price}** coins!\nWallet: **${e.balance.toLocaleString()}** coins`)] });
  }

  else if (commandName === 'inventory') {
    const inv = inventory.get(user.id) || [];
    const desc = inv.length === 0 ? 'Your inventory is empty! Use /shop to buy items.' : inv.map(i => `${i.emoji} **${i.item}** x${i.quantity}`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#7289DA').setTitle(`🎒 ${user.username}'s Inventory`).setDescription(desc)] });
  }

  // ══ GAMBLING ═════════════════════════════════════════════════════
  else if (commandName === 'coinflip') {
    const choice = interaction.options.getString('choice');
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = choice === result;
    e.balance += won ? bet : -bet;
    if (won) e.totalWon += bet; else e.totalLost += bet;
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? '#57F287' : '#ED4245')
      .setTitle(`🪙 Coin Flip — ${won ? 'YOU WON!' : 'YOU LOST!'}`)
      .setDescription(`The coin landed on **${result}** ${result === 'heads' ? '🟡' : '⬜'}\n${won ? `+${bet.toLocaleString()}` : `-${bet.toLocaleString()}`} coins\nBalance: **${e.balance.toLocaleString()}** coins`)
      .setFooter({ text: 'All Nighter Gambling 🎰' })] });
  }

  else if (commandName === 'slots') {
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const symbols = ['🍒', '🍋', '🍊', '⭐', '💎', '7️⃣', '🎰'];
    const w = () => symbols[Math.floor(Math.random() * symbols.length)];
    const reels = [[w(),w(),w()],[w(),w(),w()],[w(),w(),w()]];
    const mid = reels[1];
    let multiplier = 0;
    if (mid[0] === mid[1] && mid[1] === mid[2]) {
      if (mid[0] === '💎') multiplier = 10;
      else if (mid[0] === '7️⃣') multiplier = 7;
      else if (mid[0] === '⭐') multiplier = 5;
      else multiplier = 3;
    } else if (mid[0] === mid[1] || mid[1] === mid[2] || mid[0] === mid[2]) {
      multiplier = 1.5;
    }
    const payout = multiplier > 0 ? Math.floor(bet * multiplier) - bet : -bet;
    e.balance += payout;
    if (payout > 0) e.totalWon += payout; else e.totalLost += Math.abs(payout);
    const slotDisplay = reels.map(r => r.join(' | ')).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(multiplier > 0 ? '#FFD700' : '#ED4245')
      .setTitle('🎰 SLOT MACHINE')
      .setDescription(`\`\`\`\n${slotDisplay}\n\`\`\`\n${multiplier > 0 ? `🎉 **${multiplier}x WIN!** +${Math.floor(bet*multiplier-bet).toLocaleString()} coins` : `💀 No match. -${bet.toLocaleString()} coins`}\nBalance: **${e.balance.toLocaleString()}** coins`)
      .setFooter({ text: 'All Nighter Slots 🎰' })] });
  }

  else if (commandName === 'dice') {
    const bet = interaction.options.getInteger('bet');
    const guess = interaction.options.getInteger('number');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const roll = Math.floor(Math.random() * 6) + 1;
    const won = roll === guess;
    const payout = won ? bet * 5 : -bet;
    e.balance += payout;
    if (payout > 0) e.totalWon += payout; else e.totalLost += Math.abs(payout);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? '#57F287' : '#ED4245')
      .setTitle(`🎲 Dice Roll — ${won ? 'JACKPOT!' : 'MISS!'}`)
      .setDescription(`You guessed **${guess}**, rolled **${roll}**!\n${won ? `🎉 +${(bet*5).toLocaleString()} coins (5x win!)` : `-${bet.toLocaleString()} coins`}\nBalance: **${e.balance.toLocaleString()}** coins`)
      .setFooter({ text: '1 in 6 chance | All Nighter Gambling' })] });
  }

  else if (commandName === 'rps') {
    const choice = interaction.options.getString('choice');
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * 3)];
    const emojiMap = { rock: '🪨', paper: '📄', scissors: '✂️' };
    const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    let result, payout;
    if (choice === botChoice) { result = 'TIE'; payout = 0; }
    else if (wins[choice] === botChoice) { result = 'WIN'; payout = bet; e.totalWon += bet; }
    else { result = 'LOSE'; payout = -bet; e.totalLost += bet; }
    e.balance += payout;
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(result === 'WIN' ? '#57F287' : result === 'TIE' ? '#FEE75C' : '#ED4245')
      .setTitle(`✂️ Rock Paper Scissors — ${result}!`)
      .setDescription(`You: **${emojiMap[choice]} ${choice}** vs Bot: **${emojiMap[botChoice]} ${botChoice}**\n${payout > 0 ? `🎉 +${payout.toLocaleString()}` : payout < 0 ? `💀 -${Math.abs(payout).toLocaleString()}` : '⚡ Push — no change'} coins\nBalance: **${e.balance.toLocaleString()}** coins`)] });
  }

  else if (commandName === 'blackjack') {
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const playerHand = [randomCard(), randomCard()];
    const dealerHand = [randomCard(), randomCard()];
    const playerTotal = handTotal(playerHand);
    const dealerTotal = handTotal(dealerHand);
    const pHand = playerHand.map(c => c.display).join(' ');
    const dVisible = dealerHand[0].display;
    if (playerTotal === 21) {
      const payout = Math.floor(bet * 1.5);
      e.balance += payout; e.totalWon += payout;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('♠️ BLACKJACK! 🎉').setDescription(`Your hand: **${pHand}** = ${playerTotal}\nDealer: **${dVisible} 🂠**\n🎉 **BLACKJACK! +${payout.toLocaleString()} coins**\nBalance: **${e.balance.toLocaleString()}** coins`)] });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj_hit_${user.id}_${bet}`).setLabel('Hit 🃏').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj_stand_${user.id}_${bet}`).setLabel('Stand ✋').setStyle(ButtonStyle.Secondary),
    );
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('♠️ Blackjack')
      .setDescription(`Your hand: **${pHand}** = ${playerTotal}\nDealer: **${dVisible} 🂠**\n\nHit or Stand?`)
      .setFooter({ text: `Bet: ${bet.toLocaleString()} coins` });
    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    const stored = { playerHand, dealerHand, bet, userId: user.id };
    // Store state in a simple way
    client.bjGames = client.bjGames || new Map();
    client.bjGames.set(`${user.id}_${bet}`, stored);
    setTimeout(() => { try { msg.edit({ components: [] }); } catch {} }, 30000);
  }

  else if (commandName === 'highlow') {
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const card = randomCard();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hl_higher_${user.id}_${bet}_${card.value}`).setLabel('Higher 📈').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hl_lower_${user.id}_${bet}_${card.value}`).setLabel('Lower 📉').setStyle(ButtonStyle.Danger),
    );
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🃏 High or Low?')
      .setDescription(`Current card: **${card.display}** (value: ${card.value})\n\nWill the next card be higher or lower?`)
      .setFooter({ text: `Bet: ${bet.toLocaleString()} coins | 2x win` });
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  else if (commandName === 'roulette') {
    const betOn = interaction.options.getString('bet_on').toLowerCase();
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });
    const spin = Math.floor(Math.random() * 37);
    const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const isRed = reds.includes(spin);
    const isBlack = spin > 0 && !isRed;
    const isGreen = spin === 0;
    let won = false, multiplier = 0;
    if (betOn === 'red' && isRed) { won = true; multiplier = 2; }
    else if (betOn === 'black' && isBlack) { won = true; multiplier = 2; }
    else if (betOn === 'green' && isGreen) { won = true; multiplier = 14; }
    else if (!isNaN(parseInt(betOn)) && parseInt(betOn) === spin) { won = true; multiplier = 36; }
    const payout = won ? bet * (multiplier - 1) : -bet;
    e.balance += payout;
    if (payout > 0) e.totalWon += payout; else e.totalLost += Math.abs(payout);
    const color = isGreen ? '🟢' : isRed ? '🔴' : '⚫';
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? '#57F287' : '#ED4245')
      .setTitle('🎡 Roulette')
      .setDescription(`The wheel spun and landed on **${spin}** ${color}\nYou bet on: **${betOn}**\n${won ? `🎉 +${payout.toLocaleString()} coins (${multiplier}x)` : `-${bet.toLocaleString()} coins`}\nBalance: **${e.balance.toLocaleString()}** coins`)
      .setFooter({ text: 'All Nighter Roulette | Red/Black/Green/<number>' })] });
  }

  else if (commandName === 'crash') {
    const bet = interaction.options.getInteger('bet');
    const e = getEconomy(user.id);
    if (e.balance < bet) return interaction.reply({ content: `❌ You only have **${e.balance}** coins!`, ephemeral: true });

    // Deduct bet upfront
    e.balance -= bet;

    // Predetermined crash point (1.01x – 10x)
    const crashAt = parseFloat((Math.random() * 8.99 + 1.01).toFixed(2));

    let multiplier = 1.00;
    let cashedOut = false;
    let cashoutMultiplier = null;

    // Build initial embed with Cash Out button
    function buildEmbed(multi, crashed = false, cashedOutAt = null) {
      const profit = cashedOutAt ? Math.floor(bet * cashedOutAt) - bet : null;
      const total  = cashedOutAt ? Math.floor(bet * cashedOutAt) : null;

      const embed = new EmbedBuilder()
        .setColor(crashed ? '#ED4245' : cashedOutAt ? '#57F287' : '#FEE75C')
        .setFooter({ text: 'All Nighter Crash 📈' });

      if (cashedOutAt) {
        embed.setTitle('💸 Cashed Out!')
          .addFields(
            { name: 'Crashed at', value: `**${crashed ? cashedOutAt : crashAt}x**`, inline: true },
            { name: 'Multiplier', value: `**${cashedOutAt}x**`, inline: true },
            { name: 'Profit', value: `+◎ ${profit.toLocaleString()}`, inline: true },
            { name: 'Total Returned', value: `◎ ${total.toLocaleString()}`, inline: false }
          )
          .setDescription('✅ You got out in time!');
      } else if (crashed) {
        embed.setTitle('💥 Crashed!')
          .setDescription(`The rocket crashed at **${crashAt}x** — you lost **◎ ${bet.toLocaleString()}**!`)
          .addFields({ name: 'Multiplier', value: `**${crashAt}x**`, inline: true });
      } else {
        embed.setTitle('📈 Crash — In Progress')
          .setDescription(`🚀 Multiplier rising... Click **Cash Out** before it crashes!`)
          .addFields(
            { name: 'Current Multiplier', value: `**${multi.toFixed(2)}x**`, inline: true },
            { name: 'Your Bet', value: `◎ ${bet.toLocaleString()}`, inline: true },
            { name: 'Current Value', value: `◎ ${Math.floor(bet * multi).toLocaleString()}`, inline: true }
          );
      }
      return embed;
    }

    const cashOutBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`crash_cashout_${user.id}`).setLabel('💸 CASH OUT').setStyle(ButtonStyle.Success)
    );

    await interaction.reply({
      embeds: [buildEmbed(multiplier)],
      components: [cashOutBtn]
    });

    const msg = await interaction.fetchReply();

    // Create a button collector — only the player who ran the command can cash out
    const collector = msg.createMessageComponentCollector({
      filter: i => i.customId === `crash_cashout_${user.id}` && i.user.id === user.id,
      time: 30000,
      max: 1
    });

    collector.on('collect', async i => {
      cashedOut = true;
      cashoutMultiplier = multiplier;
      clearInterval(ticker);
      const payout = Math.floor(bet * cashoutMultiplier);
      const profit = payout - bet;
      e.balance += payout;
      e.totalWon += profit;
      await i.update({
        embeds: [buildEmbed(multiplier, false, cashoutMultiplier)],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('crash_done').setLabel('💸 CASH OUT').setStyle(ButtonStyle.Success).setDisabled(true)
        )]
      });
    });

    // Tick the multiplier every 1.5s
    const ticker = setInterval(async () => {
      if (cashedOut) { clearInterval(ticker); return; }
      multiplier = parseFloat((multiplier + (Math.random() * 0.3 + 0.1)).toFixed(2));

      if (multiplier >= crashAt) {
        clearInterval(ticker);
        collector.stop('crashed');
        e.totalLost += bet;
        try {
          await interaction.editReply({
            embeds: [buildEmbed(multiplier, true)],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('crash_done').setLabel('💥 CRASHED').setStyle(ButtonStyle.Danger).setDisabled(true)
            )]
          });
        } catch {}
        return;
      }

      // Update the live embed
      try {
        await interaction.editReply({ embeds: [buildEmbed(multiplier)], components: [cashOutBtn] });
      } catch {}
    }, 1500);

    // If time runs out and player never cashed out, crash it
    collector.on('end', async (collected, reason) => {
      if (reason === 'time' && !cashedOut) {
        clearInterval(ticker);
        e.totalLost += bet;
        try {
          await interaction.editReply({
            embeds: [buildEmbed(multiplier, true)],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('crash_done').setLabel('💥 CRASHED').setStyle(ButtonStyle.Danger).setDisabled(true)
            )]
          });
        } catch {}
      }
    });
  }

  else if (commandName === 'lottery') {
    const tickets = interaction.options.getInteger('tickets');
    const cost = tickets * 10;
    const e = getEconomy(user.id);
    if (e.balance < cost) return interaction.reply({ content: `❌ You need **${cost}** coins for ${tickets} ticket(s) but only have **${e.balance}**!`, ephemeral: true });
    e.balance -= cost;
    const prize = Math.floor(Math.random() * 5000 + 500);
    const won = Math.random() < tickets * 0.03;
    if (won) { e.balance += prize; e.totalWon += prize; }
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(won ? '#FFD700' : '#ED4245')
      .setTitle('🎟️ Lottery')
      .setDescription(`You bought **${tickets} ticket(s)** for **${cost} coins**.\n\n${won ? `🎉 **WINNER! You won ${prize.toLocaleString()} coins!** 🎊` : `😭 **No luck this time!** Better luck next draw!`}\nBalance: **${e.balance.toLocaleString()}** coins`)
      .setFooter({ text: '3% win chance per ticket | All Nighter Lottery' })] });
  }

  // ══ ACTIONS ══════════════════════════════════════════════════════
  else if (commandName === 'hug') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime hug', `🤗 <@${user.id}> hugs <@${target.id}>!`, '#FF73FA');
  }
  else if (commandName === 'kiss') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime kiss', `💋 <@${user.id}> kisses <@${target.id}>!`, '#FF69B4');
  }
  else if (commandName === 'slap') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime slap', `👋 <@${user.id}> slaps <@${target.id}>! OOF.`, '#ED4245');
  }
  else if (commandName === 'poke') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime poke', `👉 <@${user.id}> pokes <@${target.id}>`, '#FEE75C');
  }
  else if (commandName === 'pat') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime headpat', `🫶 <@${user.id}> pats <@${target.id}> on the head!`, '#57F287');
  }
  else if (commandName === 'cry') {
    await actionEmbed(interaction, 'anime crying', `😭 <@${user.id}> is crying...`, '#5865F2');
  }
  else if (commandName === 'dance') {
    await actionEmbed(interaction, 'anime dance', `💃 <@${user.id}> is dancing!`, '#EB459E');
  }
  else if (commandName === 'facepalm') {
    await actionEmbed(interaction, 'anime facepalm', `🤦 <@${user.id}> facepalms`, '#7289DA');
  }
  else if (commandName === 'highfive') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime high five', `🙌 <@${user.id}> high fives <@${target.id}>!`, '#57F287');
  }
  else if (commandName === 'bite') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime bite', `😬 <@${user.id}> bites <@${target.id}>! Ouch!`, '#ED4245');
  }
  else if (commandName === 'punch') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime punch', `🥊 <@${user.id}> punches <@${target.id}>!`, '#ED4245');
  }
  else if (commandName === 'wave') {
    const target = interaction.options.getUser('user');
    const title = target ? `👋 <@${user.id}> waves at <@${target.id}>!` : `👋 <@${user.id}> waves at everyone!`;
    await actionEmbed(interaction, 'anime wave', title, '#5865F2');
  }
  else if (commandName === 'cuddle') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime cuddle', `🥰 <@${user.id}> cuddles with <@${target.id}>!`, '#FF73FA');
  }
  else if (commandName === 'boop') {
    const target = interaction.options.getUser('user');
    await actionEmbed(interaction, 'anime boop nose', `👃 <@${user.id}> boops <@${target.id}> on the nose!`, '#FEE75C');
  }
  else if (commandName === 'owo') {
    await actionEmbed(interaction, 'uwu owo anime cat', `OwO What's this? *notices ur presence* 🐾 UwU`, '#FF73FA');
  }
  else if (commandName === 'kill') {
    const target = interaction.options.getUser('user');
    const method = killMethods[Math.floor(Math.random() * killMethods.length)];
    await actionEmbed(interaction, 'anime battle fight', `⚔️ <@${user.id}> ${method} <@${target.id}>! RIP. 💀`, '#ED4245');
  }
  else if (commandName === 'fight') {
    const target = interaction.options.getUser('user');
    const outcome = fightOutcomes[Math.floor(Math.random() * fightOutcomes.length)];
    const winner = Math.random() < 0.5 ? user : target;
    const loser = winner.id === user.id ? target : user;
    await actionEmbed(interaction, 'anime fight battle', `🥊 <@${winner.id}> beats <@${loser.id}> ${outcome}!`, '#ED4245');
  }

  else if (commandName === 'marry') {
    const target = interaction.options.getUser('user');
    if (target.id === user.id) return interaction.reply({ content: '❌ You cannot marry yourself!', ephemeral: true });
    if (marriages.has(user.id)) return interaction.reply({ content: `❌ You're already married! Use /divorce first.`, ephemeral: true });
    if (marriages.has(target.id)) return interaction.reply({ content: `❌ <@${target.id}> is already married!`, ephemeral: true });
    marriages.set(user.id, target.id);
    marriages.set(target.id, user.id);
    const embed = new EmbedBuilder()
      .setColor('#FF69B4').setTitle('💍 Marriage!')
      .setDescription(`<@${user.id}> and <@${target.id}> are now married! 🎊\n\n*May your ping always be low and your wallets always be full.* 💰❤️`)
      .setFooter({ text: 'All Nighter Bot 💍' });
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'divorce') {
    if (!marriages.has(user.id)) return interaction.reply({ content: '❌ You are not married!', ephemeral: true });
    const partner = marriages.get(user.id);
    marriages.delete(user.id);
    marriages.delete(partner);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('💔 Divorce').setDescription(`<@${user.id}> has filed for divorce. 💔\nIt's officially over.`)] });
  }

  // ══ STUDY ════════════════════════════════════════════════════════
  else if (commandName === 'studystart') {
    const subject = interaction.options.getString('subject');
    studyData.set(user.id, { startTime: Date.now(), subject });
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('📚 Study Session Started!')
      .setDescription(`**Subject:** ${subject}\n**Student:** <@${user.id}>\n\nLock in. No distractions. 🔥\nUse \`/studystop\` when done!`)
      .setFooter({ text: 'All Nighter • Stay focused 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'studystop') {
    if (!studyData.has(user.id)) return interaction.reply({ content: "❌ No active session! Use `/studystart` first.", ephemeral: true });
    const { startTime, subject } = studyData.get(user.id);
    studyData.delete(user.id);
    const mins = Math.floor((Date.now() - startTime) / 60000);
    const prev = studyLeaderboard.get(user.id) || 0;
    studyLeaderboard.set(user.id, prev + mins);
    const coins = mins * 5;
    addMoney(user.id, coins);
    addXP(user.id, mins * 10);
    const grade = mins >= 60 ? '🏆 Legend' : mins >= 30 ? '🔥 Grinder' : mins >= 10 ? '📚 Good effort' : '😬 A bit short!';
    const embed = new EmbedBuilder().setColor('#57F287').setTitle('⏱️ Study Session Complete!')
      .addFields(
        { name: '📖 Subject', value: subject, inline: true },
        { name: '⏰ Duration', value: `${mins} minutes`, inline: true },
        { name: '🏅 Rating', value: grade, inline: true },
        { name: '💰 Coins Earned', value: `+${coins} coins`, inline: true },
        { name: '⭐ XP Earned', value: `+${mins * 10} XP`, inline: true },
        { name: '📊 Total Time', value: `${prev + mins} mins`, inline: true },
      )
      .setFooter({ text: 'All Nighter • You earned a break! 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'board') {
    const sorted = [...studyLeaderboard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const desc = sorted.length === 0 ? 'No study sessions yet!' : sorted.map(([id, mins], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> — **${mins} mins**`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Study Leaderboard').setDescription(desc).setTimestamp()] });
  }

  else if (commandName === 'pomodoro') {
    const embed = new EmbedBuilder().setColor('#FF6B35').setTitle('🍅 Pomodoro Timer Started!')
      .setDescription(`**Study for 25 minutes** → Break for 5 minutes\n\nPut your phone down. Let's go. 📚\nI'll remind you in 25 minutes!`)
      .setFooter({ text: 'Pomodoro Technique | All Nighter 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
    setTimeout(async () => {
      try { await interaction.followUp(`⏰ <@${user.id}> Your 25-minute Pomodoro is done! Take a **5 min break** 🍵`); } catch {}
    }, 25 * 60 * 1000);
  }

  // ══ INFO / UTILITY ════════════════════════════════════════════════
  else if (commandName === 'userinfo') {
    const target = interaction.options.getMember('user') || interaction.member;
    const u = target.user;
    const xp = getXP(u.id);
    const eco = getEconomy(u.id);
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`👤 ${u.username}`)
      .setThumbnail(u.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🆔 ID', value: u.id, inline: true },
        { name: '📅 Joined Discord', value: u.createdAt.toDateString(), inline: true },
        { name: '📥 Joined Server', value: target.joinedAt?.toDateString() || 'Unknown', inline: true },
        { name: '🌟 Level', value: `${xp.level}`, inline: true },
        { name: '💰 Balance', value: `${eco.balance.toLocaleString()} coins`, inline: true },
        { name: '🤝 Married to', value: marriages.has(u.id) ? `<@${marriages.get(u.id)}>` : 'Nobody 💔', inline: true },
      )
      .setFooter({ text: 'All Nighter Bot 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'serverinfo') {
    const g = interaction.guild;
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🌐 ${g.name}`)
      .setThumbnail(g.iconURL())
      .addFields(
        { name: '👑 Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: '👥 Members', value: `${g.memberCount}`, inline: true },
        { name: '📅 Created', value: g.createdAt.toDateString(), inline: true },
        { name: '📢 Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: '😄 Emojis', value: `${g.emojis.cache.size}`, inline: true },
        { name: '🚀 Boosts', value: `${g.premiumSubscriptionCount || 0}`, inline: true },
      )
      .setFooter({ text: 'All Nighter Bot 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'avatar') {
    const target = interaction.options.getUser('user') || user;
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🖼️ ${target.username}'s Avatar`)
      .setImage(target.displayAvatarURL({ size: 1024 }))
      .setFooter({ text: 'All Nighter Bot 🌙' });
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply({ content: null, embeds: [new EmbedBuilder()
      .setColor('#57F287').setTitle('🏓 Pong!')
      .addFields(
        { name: '⏱️ Roundtrip', value: `${latency}ms`, inline: true },
        { name: '💓 API Heartbeat', value: `${Math.round(client.ws.ping)}ms`, inline: true },
      )] });
  }

  else if (commandName === 'afk') {
    const reason = interaction.options.getString('reason') || 'No reason given 😴';
    afkData.set(user.id, reason);
    await interaction.reply(`😴 **${user.username}** is now AFK: *${reason}*`);
  }

  else if (commandName === 'snipe') {
    if (!lastDeletedMsg) return interaction.reply({ content: '❌ Nothing to snipe! The shadow realm is empty.', ephemeral: true });
    const embed = new EmbedBuilder().setColor('#ED4245').setTitle('👁️ Sniped!')
      .setDescription(lastDeletedMsg.content || '*[no text]*')
      .setAuthor({ name: lastDeletedMsg.author.tag, iconURL: lastDeletedMsg.author.displayAvatarURL() })
      .setFooter({ text: `Deleted in #${lastDeletedMsg.channel.name}` }).setTimestamp(lastDeletedMsg.createdTimestamp);
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'poll') {
    const question = interaction.options.getString('question');
    const opts = [interaction.options.getString('option1'), interaction.options.getString('option2'), interaction.options.getString('option3'), interaction.options.getString('option4')].filter(Boolean);
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
    const desc = opts.map((o, i) => `${emojis[i]} ${o}`).join('\n\n');
    const msg = await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle(`📊 ${question}`).setDescription(desc).setFooter({ text: `By ${user.username}` }).setTimestamp()], fetchReply: true });
    for (let i = 0; i < opts.length; i++) await msg.react(emojis[i]);
  }

  else if (commandName === 'calculate') {
    const expr = interaction.options.getString('expression');
    try {
      const result = Function('"use strict"; return (' + expr.replace(/[^0-9+\-*/().%\s]/g, '') + ')')();
      await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('🧮 Calculator')
        .addFields({ name: 'Expression', value: `\`${expr}\``, inline: true }, { name: 'Result', value: `\`${result}\``, inline: true })] });
    } catch { await interaction.reply({ content: '❌ Invalid expression.', ephemeral: true }); }
  }

  else if (commandName === 'remind') {
    const minutes = interaction.options.getInteger('minutes');
    const message = interaction.options.getString('message');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('⏰ Reminder Set!')
      .setDescription(`I'll remind you in **${minutes} minute(s)** about:\n> ${message}`)] });
    setTimeout(async () => {
      try { await interaction.followUp(`⏰ <@${user.id}> Reminder: **${message}**`); } catch {}
    }, minutes * 60 * 1000);
  }

  else if (commandName === 'rank') {
    const target = interaction.options.getUser('user') || user;
    const xp = getXP(target.id);
    const embed = new EmbedBuilder().setColor('#EB459E').setTitle(`🌟 ${target.username}'s Rank`)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(`**Level ${xp.level}**\n${xpBar(xp.xp, xp.level)}`)
      .setFooter({ text: 'Earn XP by chatting and studying! | All Nighter' });
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'xpleaderboard') {
    const sorted = [...xpData.entries()].map(([id, d]) => ({ id, level: d.level, xp: d.xp })).sort((a, b) => b.level - a.level || b.xp - a.xp).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const desc = sorted.length === 0 ? 'No data yet!' : sorted.map((e, i) => `${medals[i] || `**${i + 1}.**`} <@${e.id}> — Level **${e.level}**`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#EB459E').setTitle('🌟 XP Leaderboard').setDescription(desc).setTimestamp()] });
  }

  // ══ MODERATION ═══════════════════════════════════════════════════
  else if (commandName === 'kick') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    if (!target.kickable) return interaction.reply({ content: '❌ I cannot kick this user!', ephemeral: true });
    await target.kick(reason);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('👢 Member Kicked')
      .setDescription(`**${target.user.tag}** has been kicked.\n**Reason:** ${reason}`).setTimestamp()] });
  }

  else if (commandName === 'ban') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    if (!target.bannable) return interaction.reply({ content: '❌ I cannot ban this user!', ephemeral: true });
    await target.ban({ reason });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('🔨 Member Banned')
      .setDescription(`**${target.user.tag}** has been banned.\n**Reason:** ${reason}`).setTimestamp()] });
  }

  else if (commandName === 'timeout') {
    const target = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    await target.timeout(minutes * 60 * 1000, reason);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle('🔇 Member Timed Out')
      .setDescription(`**${target.user.tag}** timed out for **${minutes} minutes**.\n**Reason:** ${reason}`).setTimestamp()] });
  }

  else if (commandName === 'warn') {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const userWarns = warnings.get(target.id) || [];
    userWarns.push({ reason, mod: user.tag, date: new Date().toDateString() });
    warnings.set(target.id, userWarns);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle('⚠️ Warning Issued')
      .setDescription(`<@${target.id}> has been warned.\n**Reason:** ${reason}\n**Total Warnings:** ${userWarns.length}`).setTimestamp()] });
  }

  else if (commandName === 'warnings') {
    const target = interaction.options.getUser('user');
    const userWarns = warnings.get(target.id) || [];
    const desc = userWarns.length === 0 ? 'No warnings on record! ✅' : userWarns.map((w, i) => `**${i+1}.** ${w.reason}\n> By ${w.mod} on ${w.date}`).join('\n\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle(`⚠️ ${target.username}'s Warnings (${userWarns.length})`).setDescription(desc)] });
  }

  else if (commandName === 'clearwarns') {
    const target = interaction.options.getUser('user');
    warnings.delete(target.id);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Warnings Cleared').setDescription(`All warnings for <@${target.id}> have been cleared.`)] });
  }

  else if (commandName === 'purge') {
    const amount = interaction.options.getInteger('amount');
    await interaction.channel.bulkDelete(amount, true);
    const msg = await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('🗑️ Messages Purged').setDescription(`Deleted **${amount}** messages.`)], fetchReply: true });
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  else if (commandName === 'slowmode') {
    const seconds = interaction.options.getInteger('seconds');
    await interaction.channel.setRateLimitPerUser(seconds);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle('🐢 Slowmode').setDescription(seconds === 0 ? 'Slowmode **disabled**.' : `Slowmode set to **${seconds} seconds**.`)] });
  }

  else if (commandName === 'lock') {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('🔒 Channel Locked').setDescription(`${interaction.channel} is now locked.`)] });
  }

  else if (commandName === 'unlock') {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('🔓 Channel Unlocked').setDescription(`${interaction.channel} is now unlocked.`)] });
  }

  else if (commandName === 'announce') {
    const message = interaction.options.getString('message');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('📢 Announcement')
      .setDescription(message).setFooter({ text: `By ${user.tag}` }).setTimestamp();
    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `✅ Announcement sent to ${channel}!`, ephemeral: true });
  }

  // ══ FUN / MISC ════════════════════════════════════════════════════
  else if (commandName === 'meme') {
    await interaction.deferReply();
    const gifUrl = await fetchGif('funny meme 2024');
    const text = memes[Math.floor(Math.random() * memes.length)];
    const embed = new EmbedBuilder().setColor('#FEE75C').setTitle('😭 Meme').setDescription(`> ${text}`).setFooter({ text: 'All Nighter 🌙' });
    if (gifUrl) embed.setImage(gifUrl);
    await interaction.editReply({ embeds: [embed] });
  }

  else if (commandName === 'gif') {
    const query = interaction.options.getString('query');
    await interaction.deferReply();
    const gifUrl = await fetchGif(query);
    if (!gifUrl) return interaction.editReply({ content: '❌ No GIF found for that query!' });
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🎥 GIF: ${query}`).setImage(gifUrl).setFooter({ text: 'All Nighter 🌙 | Powered by Tenor' });
    await interaction.editReply({ embeds: [embed] });
  }

  else if (commandName === 'motivation') {
    await actionEmbed(interaction, 'anime determined motivation', `✨ *"${motivations[Math.floor(Math.random() * motivations.length)]}"*`, '#EB459E');
  }

  else if (commandName === '8ball') {
    const question = interaction.options.getString('question');
    const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#2B2D31').setTitle('🎱 Magic 8-Ball')
      .addFields({ name: '❓ Question', value: question }, { name: '🎱 Answer', value: answer })] });
  }

  else if (commandName === 'roast') {
    const target = interaction.options.getUser('user') || user;
    const roast = roasts[Math.floor(Math.random() * roasts.length)];
    await actionEmbed(interaction, 'anime roast fire burn', `🔥 <@${target.id}> — ${roast}`, '#ED4245');
  }

  else if (commandName === 'rizz') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF73FA').setTitle('💘 Rizz Line').setDescription(`> *"${rizzLines[Math.floor(Math.random() * rizzLines.length)]}"*`).setFooter({ text: 'Use responsibly 💀 | All Nighter' })] });
  }

  else if (commandName === 'funphrase') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#7289DA').setTitle('😂 Student Vibes').setDescription(`> ${funPhrases[Math.floor(Math.random() * funPhrases.length)]}`).setFooter({ text: 'All Nighter 🌙' })] });
  }

  else if (commandName === 'joke') {
    const [setup, punchline] = jokes[Math.floor(Math.random() * jokes.length)];
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle('😄 Joke Time!').addFields({ name: 'Setup', value: setup }, { name: 'Punchline', value: `||${punchline}||` }).setFooter({ text: 'Hover/tap punchline to reveal | All Nighter' })] });
  }

  else if (commandName === 'fact') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('🧠 Did You Know?').setDescription(facts[Math.floor(Math.random() * facts.length)]).setFooter({ text: 'All Nighter Bot 🌙' })] });
  }

  else if (commandName === 'ship') {
    const u1 = interaction.options.getUser('user1');
    const u2 = interaction.options.getUser('user2');
    const seed = (u1.id + u2.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const percent = seed % 101;
    const bar = '❤️'.repeat(Math.floor(percent / 10)) + '🖤'.repeat(10 - Math.floor(percent / 10));
    const verdict = percent >= 80 ? '💍 Soulmates!' : percent >= 60 ? '💕 Great match!' : percent >= 40 ? '🤝 Could work!' : percent >= 20 ? '😬 Hmm...' : '💀 RUN!';
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF69B4').setTitle(`❤️ Shipping ${u1.username} & ${u2.username}`)
      .setDescription(`${bar}\n\n**${percent}% compatible!**\n${verdict}`)
      .setFooter({ text: 'All Nighter Ship 💘' })] });
  }

  else if (commandName === 'pp') {
    const target = interaction.options.getUser('user') || user;
    const seed = parseInt(target.id.slice(-4), 10);
    const size = seed % 15;
    const bar = '8' + '='.repeat(size) + 'D';
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#7289DA').setTitle(`🍆 ${target.username}'s PP Size`).setDescription(`\`${bar}\`\n**${size + 1} inches**`).setFooter({ text: 'Totally scientific | All Nighter' })] });
  }

  else if (commandName === 'iq') {
    const target = interaction.options.getUser('user') || user;
    const seed = parseInt(target.id.slice(-4), 10);
    const iq = (seed % 170) + 30;
    const verdict = iq >= 150 ? '🧠 Genius' : iq >= 120 ? '📚 Smart' : iq >= 100 ? '😐 Average' : iq >= 80 ? '😬 Below average' : '💀 Yikes';
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle(`🧠 ${target.username}'s IQ`).setDescription(`**IQ: ${iq}** — ${verdict}`).setFooter({ text: 'Totally scientifically accurate | All Nighter' })] });
  }

  else if (commandName === 'simp') {
    const target = interaction.options.getUser('user') || user;
    const seed = parseInt(target.id.slice(-4), 10);
    const rating = seed % 101;
    const verdict = rating >= 90 ? '🥺 MAXIMUM SIMP' : rating >= 70 ? '💘 Heavy Simp' : rating >= 50 ? '😅 Moderate Simp' : rating >= 30 ? '😏 Slight Simp' : '😎 No Simp';
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF73FA').setTitle(`🥺 Simp Rating: ${target.username}`).setDescription(`**${rating}% Simp** — ${verdict}`)] });
  }

  else if (commandName === 'clap') {
    const text = interaction.options.getString('text');
    await interaction.reply(text.split(' ').join(' 👏 ') + ' 👏');
  }

  else if (commandName === 'reverse') {
    const text = interaction.options.getString('text');
    await interaction.reply(`🔄 ${text.split('').reverse().join('')}`);
  }

  else if (commandName === 'say') {
    const message = interaction.options.getString('message');
    await interaction.reply({ content: '✅ Sent!', ephemeral: true });
    await interaction.channel.send(message);
  }

  else if (commandName === 'topic') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('💬 Conversation Starter').setDescription(topics[Math.floor(Math.random() * topics.length)]).setFooter({ text: 'All Nighter 🌙' })] });
  }

  else if (commandName === 'wyr') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#EB459E').setTitle('🤔 Would You Rather?').setDescription(wyrQuestions[Math.floor(Math.random() * wyrQuestions.length)]).setFooter({ text: 'Reply in chat! | All Nighter' })] });
  }

  else if (commandName === 'neverhaveiever') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FEE75C').setTitle('🍻 Never Have I Ever...').setDescription(nhiQuestions[Math.floor(Math.random() * nhiQuestions.length)]).setFooter({ text: '✅ = Done it | ❌ = Never done it | All Nighter' })] });
  }

  else if (commandName === 'help') {
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🌙 All Nighter — Full Command List').setDescription('Your ultimate Discord server bot!')
      .addFields(
        { name: '💰 Economy', value: '`/balance` `/daily` `/weekly` `/work` `/crime` `/deposit` `/withdraw` `/give` `/rob` `/leaderboard` `/shop` `/buy` `/inventory`' },
        { name: '🎰 Gambling', value: '`/coinflip` `/slots` `/dice` `/rps` `/blackjack` `/crash` `/highlow` `/roulette` `/lottery`' },
        { name: '🤗 Actions', value: '`/hug` `/kiss` `/slap` `/poke` `/pat` `/cry` `/dance` `/facepalm` `/highfive` `/bite` `/punch` `/wave` `/cuddle` `/boop` `/owo` `/kill` `/fight` `/marry` `/divorce`' },
        { name: '📚 Study', value: '`/studystart` `/studystop` `/board` `/pomodoro`' },
        { name: '👤 Info / Utility', value: '`/userinfo` `/serverinfo` `/avatar` `/ping` `/afk` `/snipe` `/poll` `/calculate` `/remind` `/rank` `/xpleaderboard`' },
        { name: '🛡️ Moderation', value: '`/kick` `/ban` `/timeout` `/warn` `/warnings` `/clearwarns` `/purge` `/slowmode` `/lock` `/unlock` `/announce`' },
        { name: '😂 Fun / Misc', value: '`/meme` `/gif` `/motivation` `/8ball` `/roast` `/rizz` `/funphrase` `/joke` `/fact` `/ship` `/pp` `/iq` `/simp` `/clap` `/reverse` `/say` `/topic` `/wyr` `/neverhaveiever`' },
      )
      .setFooter({ text: 'All Nighter v2.0 • Stay up, stay grinding 🌙' }).setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// ─── Button Interactions (Blackjack + High/Low) ───────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const [action, sub, userId, betStr] = interaction.customId.split('_');

  // High / Low
  if (action === 'hl') {
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your game!', ephemeral: true });
    const bet = parseInt(betStr.split('_')[0]);
    const prevValue = parseInt(interaction.customId.split('_')[4]);
    const e = getEconomy(userId);
    const nextCard = randomCard();
    const won = (sub === 'higher' && nextCard.value > prevValue) || (sub === 'lower' && nextCard.value < prevValue);
    e.balance += won ? bet : -bet;
    if (won) e.totalWon += bet; else e.totalLost += bet;
    await interaction.update({ embeds: [new EmbedBuilder()
      .setColor(won ? '#57F287' : '#ED4245')
      .setTitle(`🃏 High / Low — ${won ? 'WIN!' : 'LOSE!'}`)
      .setDescription(`Next card was **${nextCard.display}** (${nextCard.value})\nYou guessed **${sub}** — ${won ? '✅ Correct!' : '❌ Wrong!'}\n${won ? `+${bet.toLocaleString()}` : `-${bet.toLocaleString()}`} coins\nBalance: **${e.balance.toLocaleString()}** coins`)
    ], components: [] });
    return;
  }

  // Blackjack
  if (action === 'bj') {
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This is not your game!', ephemeral: true });
    const bet = parseInt(betStr);
    const game = client.bjGames?.get(`${userId}_${bet}`);
    if (!game) return interaction.reply({ content: '❌ Game expired!', ephemeral: true });
    const e = getEconomy(userId);

    if (sub === 'hit') {
      game.playerHand.push(randomCard());
      const total = handTotal(game.playerHand);
      const handStr = game.playerHand.map(c => c.display).join(' ');
      if (total > 21) {
        e.balance -= bet; e.totalLost += bet;
        client.bjGames.delete(`${userId}_${bet}`);
        return interaction.update({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('♠️ Blackjack — BUST!')
          .setDescription(`Your hand: **${handStr}** = ${total}\n💀 **BUST! -${bet.toLocaleString()} coins**\nBalance: **${e.balance.toLocaleString()}** coins`)], components: [] });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${userId}_${bet}`).setLabel('Hit 🃏').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${userId}_${bet}`).setLabel('Stand ✋').setStyle(ButtonStyle.Secondary),
      );
      return interaction.update({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('♠️ Blackjack')
        .setDescription(`Your hand: **${handStr}** = ${total}\nDealer: **${game.dealerHand[0].display} 🂠**\n\nHit or Stand?`)
        .setFooter({ text: `Bet: ${bet.toLocaleString()} coins` })], components: [row] });
    }

    if (sub === 'stand') {
      const playerTotal = handTotal(game.playerHand);
      let dealerTotal = handTotal(game.dealerHand);
      while (dealerTotal < 17) { game.dealerHand.push(randomCard()); dealerTotal = handTotal(game.dealerHand); }
      const dealerStr = game.dealerHand.map(c => c.display).join(' ');
      const playerStr = game.playerHand.map(c => c.display).join(' ');
      let result, payout;
      if (dealerTotal > 21 || playerTotal > dealerTotal) { result = '🎉 YOU WIN!'; payout = bet; e.totalWon += bet; }
      else if (playerTotal === dealerTotal) { result = '⚡ PUSH — TIE'; payout = 0; }
      else { result = '💀 DEALER WINS'; payout = -bet; e.totalLost += bet; }
      e.balance += payout;
      client.bjGames.delete(`${userId}_${bet}`);
      return interaction.update({ embeds: [new EmbedBuilder()
        .setColor(payout > 0 ? '#57F287' : payout < 0 ? '#ED4245' : '#FEE75C')
        .setTitle(`♠️ Blackjack — ${result}`)
        .setDescription(`Your: **${playerStr}** = ${playerTotal}\nDealer: **${dealerStr}** = ${dealerTotal}\n${payout > 0 ? `+${payout.toLocaleString()}` : payout < 0 ? `-${Math.abs(payout).toLocaleString()}` : 'No change'} coins\nBalance: **${e.balance.toLocaleString()}** coins`)], components: [] });
    }
  }
});

client.login(token);