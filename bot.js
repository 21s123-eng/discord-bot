import {
    Client,
    GatewayIntentBits,
    AuditLogEvent,
    ChannelType,
    Partials,
    ApplicationCommandOptionType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import {
    joinVoiceChannel,
    getVoiceConnection,
} from '@discordjs/voice';
import fs from 'fs';

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

const VERIFY_CHANNEL_ID = '1492435148439027722';
const VERIFY_EMOJI = '✅';
const VERIFY_ROLE_ID = '1495099381639020736';
const UNVERIFIED_ROLE_ID = '1491831215219806248';

const AVATAR_SEPARATOR_FILE = './separator.png';
const AVATAR_SEPARATOR_FILE_2 = './separator2.png';

const VIDEO_REACTION_CHANNEL_ID = '1490108870524276876';
const VIDEO_REACTION_CHANNEL_2_ID = '1490111448754421850';
const VIDEO_REACTION_CHANNEL_ALLOW_IMAGES_ID = '1497203030678962356';
const VIDEO_REACTIONS = ['🔥', '🤣'];
const MEDIA_ONLY_TIMEOUT_MS = 5 * 60 * 1000;
const ROLE_LOG_CHANNEL_ID = '1493286656235540611';
const WAIT_ROOM_ID = '1493287394466861317';
const SECOND_WAIT_ROOM_ID = '1495053611128852670';
const TIMEOUT_LOG_CHANNEL_ID = '1494342102979444736';
const SERVER_LOG_CHANNEL_ID = '1494342769714663524';
const MESSAGE_LOG_CHANNEL_ID = '1494807380024754367';
const VOICE_LOG_CHANNEL_ID = '1495169802363342848';
const messageCache = new Map();
const TICKET_CATEGORY_GENERAL_ID = '1490131505387933807';
const TICKET_CATEGORY_TIK_ID = '1494815199784603738';
const TICKET_CATEGORY_GENERAL_2_ID = '1495089181179773038';
const TICKET_CATEGORY_RANK_ID = '1495100386132889682';
const TICKET_CATEGORY_STRE_ID = '1490108866678231050';
const TICKET_CATEGORY_BUY_ID = '1497184252314386514';
const TICKET_CATEGORY_SUB_ID = '1497195629636485160';
const TICKET_CLAIM_LOG_CHANNEL_ID = '1494815750777471198';

const GENERAL_TICKET_CLAIM_ROLE_IDS = new Set([
    '1490156350896996413',
    '1491811256896589905',
    '1491823288249356409',
    '1491822347181756597',
    '1491831219393134745',
    '1491831219963433080',
    '1491831217627074582',
    '1491831209834319952',
    '1491831212573200506',
    '1491821748801507409',
]);

const GENERAL_2_TICKET_CLAIM_ROLE_IDS = new Set([
    '1495045802685366423',
    '1495045776823549992',
    '1495045761224675398',
    '1495045740903534622',
    '1495045718086516868',
    '1495045700856188949',
    '1495045657050742784',
    '1495045645780910160',
    '1495045612264231133',
    '1495045913591414846',
    '1490156350896996413',
]);

const TIK_TICKET_CLAIM_ROLE_IDS = new Set([
    '1494831143697252372',
    '1492989594445283489',
]);
const RANK_TICKET_CLAIM_ROLE_IDS = new Set([
    '1495045657050742784',
    '1495045645780910160',
    '1495045612264231133',
    '1495045913591414846',
    '1491822347181756597',
    '1491823288249356409',
    '1491811256896589905',
    '1490156350896996413',
    '1491831219393134745',
]);

const BUY_TICKET_CLAIM_ROLE_IDS = new Set([
    '1497186534250512506',
    '1490156350896996413',
]);

const SUB_TICKET_CLAIM_ROLE_IDS = new Set([
    '1490156350896996413',
    '1497199596449824880',
]);

const TICKET_CLAIM_ROLE_CONFIG = {
    [TICKET_CATEGORY_GENERAL_ID]: GENERAL_TICKET_CLAIM_ROLE_IDS,
    [TICKET_CATEGORY_GENERAL_2_ID]: GENERAL_2_TICKET_CLAIM_ROLE_IDS,
    [TICKET_CATEGORY_TIK_ID]: TIK_TICKET_CLAIM_ROLE_IDS,
    [TICKET_CATEGORY_STRE_ID]: TIK_TICKET_CLAIM_ROLE_IDS,
    [TICKET_CATEGORY_RANK_ID]: RANK_TICKET_CLAIM_ROLE_IDS,
    [TICKET_CATEGORY_BUY_ID]: BUY_TICKET_CLAIM_ROLE_IDS,
    [TICKET_CATEGORY_SUB_ID]: SUB_TICKET_CLAIM_ROLE_IDS,
};
const voiceConnections = new Map();
const activeTickets  = new Map(); // channelId → { creatorId, type, categoryId, claimed }
const ticketCounters = new Map(); // guildId → number
const ticketStats = new Map(); // guildId → { categoryId: count }
const TICKET_STATS_FILE = './ticket_stats.json';

function loadTicketStats() {
    try {
        if (!fs.existsSync(TICKET_STATS_FILE)) return;
        const raw = fs.readFileSync(TICKET_STATS_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [guildId, stats] of Object.entries(data)) {
            ticketStats.set(guildId, stats);
        }
    } catch (err) {
        console.log(`[TICKET STATS LOAD ERR] ${err.message}`);
    }
}

function saveTicketStats() {
    try {
        const obj = Object.fromEntries(ticketStats);
        fs.writeFileSync(TICKET_STATS_FILE, JSON.stringify(obj, null, 2));
    } catch (err) {
        console.log(`[TICKET STATS SAVE ERR] ${err.message}`);
    }
}

function incrementTicketStat(guildId, categoryId) {
    const stats = ticketStats.get(guildId) ?? {};
    stats[categoryId] = (stats[categoryId] ?? 0) + 1;
    ticketStats.set(guildId, stats);
    saveTicketStats();
}

loadTicketStats();

const ticketClaimStats = new Map(); // guildId → { userId: count }
const TICKET_CLAIM_STATS_FILE = './ticket_claim_stats.json';

function loadTicketClaimStats() {
    try {
        if (!fs.existsSync(TICKET_CLAIM_STATS_FILE)) return;
        const raw = fs.readFileSync(TICKET_CLAIM_STATS_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [guildId, claims] of Object.entries(data)) {
            ticketClaimStats.set(guildId, claims);
        }
    } catch (err) {
        console.log(`[TICKET CLAIM STATS LOAD ERR] ${err.message}`);
    }
}

function saveTicketClaimStats() {
    try {
        const obj = Object.fromEntries(ticketClaimStats);
        fs.writeFileSync(TICKET_CLAIM_STATS_FILE, JSON.stringify(obj, null, 2));
    } catch (err) {
        console.log(`[TICKET CLAIM STATS SAVE ERR] ${err.message}`);
    }
}

function incrementTicketClaim(guildId, userId) {
    const claims = ticketClaimStats.get(guildId) ?? {};
    claims[userId] = (claims[userId] ?? 0) + 1;
    ticketClaimStats.set(guildId, claims);
    saveTicketClaimStats();
}

loadTicketClaimStats();

const ADMIN_VOICE_CHANNELS = [
    '1492449319184502794',
    '1492449365611249715',
    '1492449422230032535',
    '1492449475912925214',
    '1492449616761852095',
    '1492449717186072606',
    '1492449967535816744',
    '1492450015703076884',
    '1492450059307192381',
    '1492450097462771833',
];

const ADMIN_ROLE_IDS = new Set([
    '1491821748801507409',
    '1491831212573200506',
    '1491831209834319952',
    '1491831217627074582',
    '1491831219963433080',
    '1491831219393134745',
    '1491822347181756597',
    '1491823288249356409',
    '1491811256896589905',
    '1490156350896996413',
]);

const SECOND_ADMIN_VOICE_CHANNELS = [
    '1495053174816509963',
    '1495053278063497357',
    '1495053225185775706',
    '1495053313757020201',
    '1495053344815714414',
    '1495053381700681728',
    '1495053418887381132',
    '1495053454354153513',
    '1495053492560199762',
    '1495053536776421618',
];

const SECOND_ADMIN_ROLE_IDS = new Set([
    '1495045802685366423',
    '1495045776823549992',
    '1495045761224675398',
    '1495045740903534622',
    '1495045718086516868',
    '1495045700856188949',
    '1495045657050742784',
    '1495045645780910160',
    '1495045612264231133',
    '1495045913591414846',
    '1490156350896996413',
]);

const VOICE_MOVE_CONFIGS = {
    [WAIT_ROOM_ID]: {
        channels: ADMIN_VOICE_CHANNELS,
        roles: ADMIN_ROLE_IDS,
    },
    [SECOND_WAIT_ROOM_ID]: {
        channels: SECOND_ADMIN_VOICE_CHANNELS,
        roles: SECOND_ADMIN_ROLE_IDS,
    },
};

const VOICE_TRANSLATE_CHANNEL_IDS = new Set([
    '1497195392461181072',
    '1497195357749252186',
    '1497195328624001155',
    '1497195296206225458',
    '1497195264992219276',
]);

const SEND_COMMAND_ROLE_IDS = new Set([
    '1491823288249356409',
    '1491811256896589905',
    '1490156350896996413',
    '1499717430417555516',
]);

const RATING_TRIGGER_ROLE_IDS = new Set([
    '1497186534250512506',
    '1490156350896996413',
]);

const RATING_TRIGGER_KEYWORD = '@&@&@';

function hasAnyRole(member, roleIds) {
    return member.roles.cache.some((role) => roleIds.has(role.id));
}

function isAdminMember(member) {
    return hasAnyRole(member, ADMIN_ROLE_IDS);
}
async function assignUnverifiedIfNoRoles(member, reason = 'Auto assign unverified') {
    if (!member || member.user.bot) return;

    const roles = member.roles.cache.filter((role) => role.id !== member.guild.id);

    if (roles.size > 0) return;

    const role = member.guild.roles.cache.get(UNVERIFIED_ROLE_ID)
        ?? await member.guild.roles.fetch(UNVERIFIED_ROLE_ID).catch(() => null);

    if (!role) {
        console.log(`[AUTO UNVERIFIED ERR] الرتبة غير موجودة: ${UNVERIFIED_ROLE_ID}`);
        return;
    }

    markBotAction(memberKey(member.guild.id, member.id));

    await member.roles.add(role, reason).catch((err) => {
        console.log(`[AUTO UNVERIFIED ERR] ${member.user.tag} — ${err.message}`);
    });

    const updated = await member.guild.members.fetch(member.id).catch(() => member);
    saveMember(updated);
    }

    async function joinBotVoiceChannel(message, channelId) {
    if (message.author.id !== OWNER_ID) return true;

    const channel = await message.guild.channels.fetch(channelId).catch(() => null);

    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
        await message.reply('الروم الصوتي غير صحيح.');
        return true;
    }

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
    });

    voiceConnections.set(message.guild.id, connection);

    await message.reply(`دخلت الروم: ${channel.name}`);
    return true;
}

async function leaveBotVoiceChannel(message) {
    if (message.author.id !== OWNER_ID) return true;

    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
        await message.reply('البوت مو داخل روم صوتي.');
        return true;
    }

    connection.destroy();
    voiceConnections.delete(message.guild.id);

    await message.reply('طلعت من الروم الصوتي.');
    return true;
}

const LINK_REGEX = /https?:\/\/\S+|www\.\S+/i;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CLEAR_COMMAND_NAME = 'clear';
const MAX_CLEAR_AMOUNT = 1000;

const AVATAR_SEPARATOR_CHANNEL_IDS = new Set([
    '1493532561895587890',
    '1493532613971935304',
    '1493532681517010995',
    '1493532722277126154',
    '1493532881425928263',
    '1493532915462701056',
    '1493532962963193977',
    '1493533171046809610',
    '1493533396561952818',
    '1493533680566796438',
    '1493533721637158922',
    '1493891000588828792',
    '1490111514437226748',
    '1490109019669663886',
    '1490108870524276876',
]);

const AVATAR_SEPARATOR_CHANNEL_2_IDS = new Set([
    '1490111448754421850',
    '1497201943897047082',
    '1497201288859881513',
    '1497201552304373980',
    '1492475128087576706',
    '1497265642737500392',
    '1490119911475908706',
    '1497265697338818823',
    '1497266452044976319',
    '1497266476409684231',
    '1497266513349185708',
    '1497266564250992670',
    '1497266733185241348',
    '1497266749085712564',
    '1497266765560942632',
    '1497266786830385213',
    '1497266802672144446',
    '1497266816807075860',
    '1497266842224562347',
    '1497266855167918271',
    '1497266867625263194',
    '1497266881508278282',
    '1497266898134634699',
    '1497332862934974595',
    '1497333007181418717',
    '1497266908041314484',
    '1497333139964428379',
    '1490109001231372520',
    '1490109011176063097',
    '1490109004461113566',
    '1490109014032253179',
    '1497203030678962356',
    '1490109021506765060',
]);

const LINK_ALLOWED_CHANNEL_IDS = new Set([
    '1492475128087576706',
    '1490119748120481914',
]);
console.log('NEW CODE VERSION - ROLE MEMBERS RESTORE');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
    ],
});

const restoringRoles = new Map();
const channelSnapshots = new Map();
const memberRoleSnapshots = new Map();

const botActions = new Set();
const punishCooldowns = new Map();
const avatarCooldowns = new Map();
const channelUpdateLocks = new Map();
const channelRestoreLogCooldowns = new Map();

const restoringChannels = new Set();

// Buffer that captures member IDs the moment a role is removed in guildMemberUpdate.
// Discord fires GUILD_MEMBER_UPDATE for each affected member BEFORE firing GUILD_ROLE_DELETE,
// so this buffer captures the members while the data is still available.
// Maps: roleId -> Set<memberId>
const deletedRoleMemberBuffer = new Map();

// Guild-level flag set while the bot is restoring a role position.
// Prevents cascade roleUpdate events from triggering their own (unnecessary) restores.
const restoringPositions = new Set();

const AUDIT_RETRIES = 4;
const AUDIT_WAIT_MS = 400;
const PUNISH_COOLDOWN_MS = 5000;
const AVATAR_SEPARATOR_COOLDOWN_MS = 3000;
const CHANNEL_UPDATE_LOCK_MS = 10000;
const CHANNEL_RESTORE_LOG_COOLDOWN_MS = 10000;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateText(text, targetLang) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
        return data[0].map((part) => part[0]).filter(Boolean).join('').trim();
    } catch (error) {
        console.log(`[TRANSLATE ERR] ${error.message}`);
        return null;
    }
}

function detectIsArabic(text) {
    return /[\u0600-\u06FF]/.test(text);
}

async function handleTranslateMessage(message) {
    const text = message.content.trim();
    if (!text) return;

    const cleanText = text
        .replace(/<@!?\d+>/g, '')
        .replace(/<@&\d+>/g, '')
        .replace(/<#\d+>/g, '')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .trim();

    if (!cleanText) return;

    const isArabic = detectIsArabic(cleanText);
    const targetLang = isArabic ? 'en' : 'ar';
    const translated = await translateText(cleanText, targetLang);

    if (!translated || translated.toLowerCase() === cleanText.toLowerCase()) return;

    await message.channel.send(`<@${message.author.id}> | ${translated}`).catch(() => {});
}
    async function moveChannelToCategoryBottom(channel) {
    await wait(1000);

    const parent = channel.parent;
    if (!parent) return;

    const channels = parent.children.cache
        .filter((ch) => ch.type === channel.type)
        .sort((a, b) => a.rawPosition - b.rawPosition);

    await channel.setPosition(channels.size - 1).catch((err) => {
        console.log(`[TICKET POSITION ERR] ${err.message}`);
    });
}

function roleKey(guildId, roleId) {
    return `${guildId}:role:${roleId}`;
}

function channelKey(guildId, channelId) {
    return `${guildId}:channel:${channelId}`;
}

function memberKey(guildId, memberId) {
    return `${guildId}:member:${memberId}`;
}

function markBotAction(key, ms = 15000) {
    botActions.add(key);
    setTimeout(() => botActions.delete(key), ms);
}

function isBotAction(key) {
    return botActions.has(key);
}

function isIgnored(userId, isBot = false) {
    return userId === OWNER_ID || userId === client.user?.id || isBot;
}

function punishOnCooldown(guildId, userId, reason) {
    const key = `${guildId}:${userId}:${reason}`;
    const last = punishCooldowns.get(key);

    if (last && Date.now() - last < PUNISH_COOLDOWN_MS) {
        return true;
    }

    punishCooldowns.set(key, Date.now());
    return false;
}
function channelUpdateLocked(key) {
    const until = channelUpdateLocks.get(key);

    if (until && until > Date.now()) {
        return true;
    }

    channelUpdateLocks.set(key, Date.now() + CHANNEL_UPDATE_LOCK_MS);
    setTimeout(() => {
        const currentUntil = channelUpdateLocks.get(key);
        if (currentUntil && currentUntil <= Date.now()) {
            channelUpdateLocks.delete(key);
        }
    }, CHANNEL_UPDATE_LOCK_MS + 500);

    return false;
}

function channelRestoreLogOnCooldown(guildId, executorId, reason) {
    const key = `${guildId}:${executorId ?? 'unknown'}:${reason}`;
    const last = channelRestoreLogCooldowns.get(key);

    if (last && Date.now() - last < CHANNEL_RESTORE_LOG_COOLDOWN_MS) {
        return true;
    }

    channelRestoreLogCooldowns.set(key, Date.now());
    return false;
}

function getTimestamp() {
    const now = new Date();
    return now.toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}
async function sendLog(guild, text) {
    const ts = getTimestamp();
    console.log(`[LOG] [${ts}] ${text}`);

    try {
        let channel = guild.channels.cache.get(SERVER_LOG_CHANNEL_ID);
        if (!channel) channel = await guild.channels.fetch(SERVER_LOG_CHANNEL_ID).catch((e) => { console.log(`[SERVER LOG FETCH ERR] ${e.message}`); return null; });

        if (!channel) { console.log(`[SERVER LOG] channel not found: ${SERVER_LOG_CHANNEL_ID}`); return; }
        if (!channel.isTextBased()) { console.log(`[SERVER LOG] channel is not text-based`); return; }

        await channel.send(`[LOG] [${ts}] ${text}`).catch((e) => console.log(`[SERVER LOG SEND ERR] ${e.message}`));
    } catch (error) {
        console.log(`[LOG ERR] ${error.message}`);
    }
}

function saveRole(role) {
    if (!role || !role.guild || role.managed) return;

    roleSnapshots.set(roleKey(role.guild.id, role.id), {
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        rawPosition: role.rawPosition,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        memberIds: [...role.members.keys()],
    });
}

function saveMember(member) {
    if (!member || !member.guild) return;

    memberRoleSnapshots.set(
        memberKey(member.guild.id, member.id),
        new Set(
            member.roles.cache
                .filter((role) => role.id !== member.guild.id)
                .map((role) => role.id)
        )
    );
}

// Scan memberRoleSnapshots to find all members who have a given roleId.
// memberRoleSnapshots is updated on every guildMemberUpdate event.
// Discord does NOT fire guildMemberUpdate when a role is deleted — it only
// removes the role from member.roles.cache internally — so this map still
// holds the pre-deletion data when roleDelete fires.
function getMembersWithRole(guildId, roleId) {
    const ids = [];
    const prefix = `${guildId}:member:`;
    for (const [key, roleSet] of memberRoleSnapshots) {
        if (key.startsWith(prefix) && roleSet.has(roleId)) {
            ids.push(key.slice(prefix.length));
        }
    }
    return ids;
}

function channelOverwrites(channel) {
    return channel.permissionOverwrites?.cache?.map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
    })) ?? [];
}

function saveChannel(channel) {
    if (!channel || !channel.guild) return;

    channelSnapshots.set(channelKey(channel.guild.id, channel.id), {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        rawPosition: channel.rawPosition ?? 0,
        parentId: channel.parentId ?? null,
        permissionOverwrites: channelOverwrites(channel),
        topic: 'topic' in channel ? channel.topic : null,
        nsfw: 'nsfw' in channel ? channel.nsfw : false,
        rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0,
        bitrate: 'bitrate' in channel ? channel.bitrate : null,
        userLimit: 'userLimit' in channel ? channel.userLimit : null,
    });
}

function toOverwrites(snapshot) {
    return snapshot.permissionOverwrites.map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: BigInt(overwrite.allow),
        deny: BigInt(overwrite.deny),
    }));
}

async function snapshotGuild(guild) {
    console.log(`[SNAPSHOT] ${guild.name}`);

    try {
        await guild.members.fetch();
    } catch (error) {
        console.log(`[SNAPSHOT MEMBERS ERR] ${error.message}`);
    }

    const roles = await guild.roles.fetch();

    for (const [, role] of roles) {
        saveRole(role);
    }

    for (const [, member] of guild.members.cache) {
        saveMember(member);
    }

    const channels = await guild.channels.fetch();

    for (const [, channel] of channels) {
        saveChannel(channel);
    }

    console.log(`[SNAPSHOT DONE] roles=${roleSnapshots.size} members=${memberRoleSnapshots.size} channels=${channelSnapshots.size}`);
}

async function getAuditExecutor(guild, type, targetId = null, strict = false) {
    const minTime = Date.now() - 30000;

    for (let i = 0; i < AUDIT_RETRIES; i++) {
        if (i > 0) await wait(AUDIT_WAIT_MS);

        try {
            const logs = await guild.fetchAuditLogs({ type, limit: 10 });
            const entries = [...logs.entries.values()];

            let entry = null;

            if (targetId) {
                entry = entries.find((item) =>
                    item.target?.id === targetId &&
                    item.executor?.id &&
                    item.executor.id !== client.user?.id &&
                    item.createdTimestamp >= minTime
                );
            }

            if (!entry && !strict) {
                entry = entries.find((item) =>
                    item.executor?.id &&
                    item.executor.id !== client.user?.id &&
                    item.createdTimestamp >= minTime
                );
            }

            if (entry?.executor) {
                return entry.executor;
            }
        } catch (error) {
            console.log(`[AUDIT ERR] ${error.message}`);
        }
    }

    return null;
}

async function removeAllRoles(member) {
    const botMember = member.guild.members.me;

    if (!botMember) {
        console.log(`[PUNISH] bot member not found in guild`);
        return 'bot_member_not_found';
    }

    const removable = member.roles.cache.filter((role) =>
        role.id !== member.guild.id &&
        !role.managed &&
        role.position < botMember.roles.highest.position
    );

    console.log(`[PUNISH] ${member.user.tag} — removing ${removable.size} roles: ${[...removable.values()].map(r => r.name).join(', ') || 'none'}`);

    const key = memberKey(member.guild.id, member.id);
    markBotAction(key);

    if (removable.size > 0) {
        await member.roles.remove([...removable.keys()], 'Protection punishment').catch((err) => {
            console.log(`[PUNISH REMOVE ERR] ${err.message}`);
        });
    }

    const fresh = await member.guild.members.fetch(member.id).catch(() => null);

    if (!fresh) {
        console.log(`[PUNISH] could not re-fetch member after role removal`);
        return `removed_${removable.size}`;
    }

    const remaining = fresh.roles.cache.filter((r) => r.id !== fresh.guild.id);

    console.log(`[PUNISH] ${member.user.tag} — roles after removal: ${remaining.size} — adding unverified role`);

    await fresh.roles.add(UNVERIFIED_ROLE_ID, 'Protection punishment: assign unverified role').catch((err) => {
        console.log(`[PUNISH ADD UNVERIFIED ERR] ${err.message}`);
    });

    saveMember(fresh);

    return `removed_${removable.size}_assigned_unverified`;
}

async function punish(guild, executor, reason) {
    if (!executor) {
        await sendLog(guild, `رجعت التغيير لكن ما قدرت أعرف الشخص من Audit Log — السبب: ${reason}`);
        return;
    }

    if (isIgnored(executor.id, executor.bot)) {
        return;
    }

    if (punishOnCooldown(guild.id, executor.id, reason)) {
        return;
    }

    try {
        const member = await guild.members.fetch(executor.id);
        const result = await removeAllRoles(member);

        await sendLog(guild, `عاقبت <@${executor.id}> — ${reason} — ${result}`);

        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);

        if (channel && channel.isTextBased()) {
            await channel.send(
                `@here\n\nperson : <@${executor.id}>\n\nthe reason : ${reason}\n\nID : ${executor.id}`
            ).catch(() => {});
        }
    } catch (error) {
        await sendLog(guild, `فشل العقاب: ${error.message}`);
    }
}

// FIX: Removed setPosition — the role is restored without forcing it back
// to the original position. Only the role properties and its members are restored.
async function restoreDeletedRole(guild, oldRoleId, snapshot) {
    restoringRoles.set(guild.id, (restoringRoles.get(guild.id) ?? 0) + 1);

    const role = await guild.roles.create({
        name: snapshot.name,
        color: snapshot.color ?? 0,
        hoist: snapshot.hoist,
        permissions: BigInt(snapshot.permissions),
        mentionable: snapshot.mentionable,
        reason: 'Protection rollback: restore deleted role',
    }).catch((error) => {
        console.log(`[RESTORE ROLE ERR] ${error.message}`);
        return null;
    });

    const cur = restoringRoles.get(guild.id) ?? 1;
    if (cur <= 1) restoringRoles.delete(guild.id);
    else restoringRoles.set(guild.id, cur - 1);

    if (!role) return null;

    markBotAction(roleKey(guild.id, role.id));

    await wait(1000);

    await role.setPosition(snapshot.rawPosition, { relative: false }).catch((err) => {
        console.log(`[RESTORE ROLE POS ERR] ${snapshot.name} — ${err.message}`);
    });

    roleSnapshots.delete(roleKey(guild.id, oldRoleId));
    roleSnapshots.set(roleKey(guild.id, role.id), {
        ...snapshot,
        id: role.id,
    });

    // Restore role to all members who had it before deletion.
    // memberIds is a union from all 5 sources collected in the roleDelete handler.
    const memberIds = snapshot.memberIds ?? [];

    console.log(`[RESTORE MEMBERS] role=${snapshot.name} members to restore=${memberIds.length}`);

     await Promise.all(memberIds.map(async (memberId) => {
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) {
            console.log(`[RESTORE MEMBERS] could not fetch member ${memberId}`);
            return;
        }
        markBotAction(memberKey(guild.id, member.id));
        await member.roles.add(role, 'Protection rollback: restore role membership').catch((err) => {
            console.log(`[RESTORE MEMBERS ERR] ${member.user.tag} — ${err.message}`);
        });
        const updated = await guild.members.fetch(member.id).catch(() => member);
        saveMember(updated);
    }));

    console.log(`[RESTORE MEMBERS DONE] role=${snapshot.name}`);

    return role;
}

async function restoreDeletedChannel(guild, snapshot) {
    restoringChannels.add(guild.id);

    const options = {
        name: snapshot.name,
        type: snapshot.type,
        permissionOverwrites: toOverwrites(snapshot),
        reason: 'Protection rollback: restore deleted channel',
    };

    if (snapshot.type !== ChannelType.GuildCategory && snapshot.parentId) {
        options.parent = snapshot.parentId;
    }

    if (
        snapshot.type === ChannelType.GuildText ||
        snapshot.type === ChannelType.GuildAnnouncement ||
        snapshot.type === ChannelType.GuildForum
    ) {
        options.topic = snapshot.topic ?? null;
        options.nsfw = snapshot.nsfw;
        options.rateLimitPerUser = snapshot.rateLimitPerUser ?? 0;
    }

    if (
        snapshot.type === ChannelType.GuildVoice ||
        snapshot.type === ChannelType.GuildStageVoice
    ) {
        if (snapshot.bitrate) options.bitrate = snapshot.bitrate;
        if (snapshot.userLimit !== null && snapshot.userLimit !== undefined) {
            options.userLimit = snapshot.userLimit;
        }
    }

    const channel = await guild.channels.create(options).catch((error) => {
        console.log(`[RESTORE CHANNEL ERR] ${error.message}`);
        return null;
    });

    restoringChannels.delete(guild.id);

    if (!channel) return null;

    markBotAction(channelKey(guild.id, channel.id));

    await wait(1000);

    await channel.setPosition(snapshot.rawPosition).catch(() => {});

    channelSnapshots.set(channelKey(guild.id, channel.id), {
        ...snapshot,
        id: channel.id,
    });

    return channel;
}

function messageHasImage(message) {
    const attachmentImage = message.attachments.some((attachment) => {
        if (attachment.contentType?.startsWith('image/')) return true;
        return /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.name ?? attachment.url ?? '');
    });

    if (attachmentImage) return true;

    return /(https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?)/i.test(message.content);
}

async function handleAvatarSeparator(message) {
    if (!message.guild) return;
    if (message.author.bot) return;

    const isAnyMsgChannel = message.channel.id === '1490119748120481914';
    const isSep2Channel = AVATAR_SEPARATOR_CHANNEL_2_IDS.has(message.channel.id);
    const isSep1Channel = AVATAR_SEPARATOR_CHANNEL_IDS.has(message.channel.id);

    if (!isAnyMsgChannel && !isSep1Channel && !isSep2Channel) return;
    if (!isAnyMsgChannel && !messageHasImage(message)) return;

    const cooldownKey = `${message.channel.id}:${message.author.id}`;
    const last = avatarCooldowns.get(cooldownKey);

    if (last && Date.now() - last < AVATAR_SEPARATOR_COOLDOWN_MS) {
        return;
    }

    avatarCooldowns.set(cooldownKey, Date.now());

    await wait(700);

    const file = isSep2Channel ? AVATAR_SEPARATOR_FILE_2 : AVATAR_SEPARATOR_FILE;

    await message.channel.send({
        files: [file],
    }).catch(async (error) => {
        console.log(`[SEPARATOR ERR] ${error.message}`);
        await sendLog(message.guild, 'فشل إرسال separator. تأكد الصورة جنب bot.js وأن البوت عنده Attach Files.');
    });
}
async function registerClearCommand(guild) {
    await guild.commands.create({
        name: CLEAR_COMMAND_NAME,
        description: 'حذف عدد معين من الرسائل في الروم',
        options: [
            {
                name: 'amount',
                description: 'عدد الرسائل من 1 إلى 1000',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                minValue: 1,
                maxValue: MAX_CLEAR_AMOUNT,
            },
        ],
    }).catch((error) => {
        console.log(`[CLEAR REGISTER ERR] ${error.message}`);
    });
}
async function handleSenddCommand(message) {
    if (!message.content.startsWith('!sendd ')) return false;

    const isOwner = message.author.id === OWNER_ID;
    const senderMember = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!isOwner && !(senderMember && hasAnyRole(senderMember, SEND_COMMAND_ROLE_IDS))) return false;

    const args = message.content.slice('!sendd '.length).trim();
    const firstSpace = args.indexOf(' ');
    const channelId = firstSpace === -1 ? args.trim() : args.slice(0, firstSpace).trim();
    const text = firstSpace === -1 ? '' : args.slice(firstSpace + 1).trim();
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        await message.reply('ما لقيت الروم.').catch(() => {});
        return true;
    }

    const attachment = [...message.attachments.values()][0] ?? null;

    const embed = new EmbedBuilder().setColor(0xFFD700);
    if (text) embed.setDescription(text);
    if (attachment) embed.setImage(attachment.url);

    await channel.send({ embeds: [embed] }).catch(() => {});
    await message.reply('تم الإرسال.').catch(() => {});
    return true;
}

async function handleSendCommand(message) {
    if (!message.content.startsWith('!send ')) return false;

    const isOwner = message.author.id === OWNER_ID;
    if (!isOwner) {
        const senderMember = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        const hasPermission = senderMember && hasAnyRole(senderMember, SEND_COMMAND_ROLE_IDS);
        if (!hasPermission) return false;
    }

    const args = message.content.slice('!send '.length).trim();
    const firstSpace = args.indexOf(' ');

    const attachments = [...message.attachments.values()];

    if (!args) {
        await message.reply('اكتب كذا: `!send CHANNEL_ID الرسالة` أو أرفق صورة').catch(() => {});
        return true;
    }

    const channelId = (firstSpace === -1 ? args : args.slice(0, firstSpace))
        .replace(/[<#>]/g, '')
        .trim();

    const text = firstSpace === -1 ? '' : args.slice(firstSpace + 1).trim();

    if (!channelId) {
        await message.reply('اكتب آيدي الروم بعد الأمر.').catch(() => {});
        return true;
    }

    if (!text && attachments.length === 0) {
        await message.reply('اكتب رسالة أو أرفق صورة.').catch(() => {});
        return true;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        await message.reply('ما لقيت الروم أو الروم مو كتابي.').catch(() => {});
        return true;
    }

    try {
        const MAX_LEN = 2000;
        const chunks = [];
        if (text) {
            let remaining = text;
            while (remaining.length > 0) {
                if (remaining.length <= MAX_LEN) {
                    chunks.push(remaining);
                    break;
                }
                let cut = remaining.lastIndexOf('\n', MAX_LEN);
                if (cut <= 0) cut = remaining.lastIndexOf(' ', MAX_LEN);
                if (cut <= 0) cut = MAX_LEN;
                chunks.push(remaining.slice(0, cut));
                remaining = remaining.slice(cut).trimStart();
            }
        }

        if (chunks.length === 0) {
            await channel.send({
                files: attachments.map((attachment) => attachment.url),
            });
        } else {
            for (let i = 0; i < chunks.length; i++) {
                await channel.send({
                    content: chunks[i],
                    files: i === 0 ? attachments.map((attachment) => attachment.url) : [],
                });
            }
        }

        if (attachments.length > 0) {
            await wait(700);

            await channel.send({
                files: [AVATAR_SEPARATOR_FILE],
            }).catch(async (error) => {
                console.log(`[SEPARATOR ERR] ${error.message}`);
                await sendLog(message.guild, 'فشل إرسال separator.png. تأكد الصورة جنب bot.js وأن البوت عنده Attach Files.');
            });
        }

        await message.reply('تم إرسال الرسالة.').catch(() => {});
    } catch (error) {
        await message.reply(`ما قدرت أرسلها: ${error.message}`).catch(() => {});
    }

    return true;
}
async function handleVerifyMessageCommand(message) {
    if (!message.content.startsWith('!verifymsg')) return false;

    let text = message.content.slice('!verifymsg'.length).trim();

    if (!text) {
        text = `*للتفعيل ودخول السيرفر اضغط على  ${VERIFY_EMOJI}  *\n*To activate and access the server, click on ${VERIFY_EMOJI}   *\n\n@here`;
    }

    const channel = await client.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        await message.reply('ما لقيت روم التفعيل أو الروم مو كتابي.').catch(() => {});
        return true;
    }

    const sent = await channel.send(text);

    await sent.react(VERIFY_EMOJI);

    await message.reply(`تم إرسال رسالة التفعيل في <#${VERIFY_CHANNEL_ID}>.`).catch(() => {});

    return true;
}

async function clearMessages(interaction, amount) {
    let deletedTotal = 0;
    let scanned = 0;
    let before = null;

    while (deletedTotal < amount && scanned < amount + 300) {
        const limit = Math.min(100, amount - deletedTotal);
        const options = { limit };

        if (before) {
            options.before = before;
        }

        const messages = await interaction.channel.messages.fetch(options);

        if (messages.size === 0) break;

        before = messages.last()?.id ?? null;
        scanned += messages.size;

        const deleteAmount = Math.min(amount - deletedTotal, messages.size);
        const selected = messages.first(deleteAmount);

        const deleted = await interaction.channel.bulkDelete(selected, true);

        deletedTotal += deleted.size;

        if (!before) break;

        await wait(1000);
    }

    return deletedTotal;
}
async function sendTicketPanel(channel, type) {
        if (type === 'rank') {
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('𝟎𝟖')
            .setDescription(
                '**تقديم على رتبه**\n\n' +
                '**اختر نوع التقديم من القائمة بالأسفل.**'
            )
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

        const select = new StringSelectMenuBuilder()
            .setCustomId('ticket_select_rank')
            .setPlaceholder('اختر نوع التذكرة')
            .addOptions([
                { label: 'تقديم على رتبه', value: 'تقديم_على_رتبه' },
                { label: 'Application',     value: 'Application' },
            ]);
        const row = new ActionRowBuilder().addComponents(select);
        await channel.send({ embeds: [embed], components: [row] });
        return;
    }

    if (type === 'buy') {
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('𝟎𝟖')
            .setDescription(
                '**افتح تذكرة**\n\n' +
                '**اختر نوع التذكرة من القائمة بالأسفل.**'
            )
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

        const select = new StringSelectMenuBuilder()
            .setCustomId('ticket_select_buy')
            .setPlaceholder('اختر نوع التذكرة')
            .addOptions([
                { label: 'شراء',      value: 'شراء' },
                { label: 'Purchase',  value: 'Purchase' },
                { label: 'استفسار',   value: 'استفسار' },
                { label: 'Inquiry',   value: 'Inquiry' },
                { label: 'شكوى',      value: 'شكوى' },
                { label: 'Complaint', value: 'Complaint' },
            ]);
        const row = new ActionRowBuilder().addComponents(select);
        await channel.send({ embeds: [embed], components: [row] });
        return;
    }

    if (type === 'sub') {
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('𝟎𝟖')
            .setDescription(
                '**افتح تذكرة**\n\n' +
                '**اختر نوع التذكرة من القائمة بالأسفل.**'
            )
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

        const select = new StringSelectMenuBuilder()
            .setCustomId('ticket_select_sub')
            .setPlaceholder('اختر نوع التذكرة')
            .addOptions([
                { label: 'Inquiry',      value: 'Inquiry' },
                { label: 'Subscription', value: 'Subscription' },
            ]);
        const row = new ActionRowBuilder().addComponents(select);
        await channel.send({ embeds: [embed], components: [row] });
        return;
    }
         if (type === 'general' || type === 'general_2') {
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('𝟎𝟖')
            .setDescription(
                '**افتح تذكرة**\n\n' +
                '**قوانين التذاكر:**\n' +
                '- الاحترام واجب وعدم التهجم في التكت.\n' +
                '- في حال فتح تكت غير مرتبط بالموضوع.\n' +
                '- يمنع الكذب والشتم والإهانة.\n' +
                '- لن يحل تكتك بعد مرور 24 ساعة من الشكوى.\n' +
                '- حسب الإساءة في الإهانة إلى المستخدم/الإداري داخل التكت.'
            )
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

        const select = new StringSelectMenuBuilder()
            .setCustomId(type === 'general_2' ? 'ticket_select_general_2' : 'ticket_select_general')
            .setPlaceholder('اختر نوع التذكرة')
            .addOptions([
                { label: 'تقديم اداره',  value: 'تقديم_اداره' },
                { label: 'Application for an administrative position', value: 'admin_application' },
                { label: 'استفسار',      value: 'استفسار' },
                { label: 'Inquiry',      value: 'inquiry' },
                { label: 'مشكله',        value: 'مشكله' },
                { label: 'Issue',        value: 'issue' },
            ]);
        const row = new ActionRowBuilder().addComponents(select);
        await channel.send({ embeds: [embed], components: [row] });
        } else {
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('𝟎𝟖')
            .setDescription(
                '**افتح تذكرة تقديم**\n\n' +
                '**قوانين التذاكر:**\n' +
                '- الاحترام واجب وعدم التهجم في التكت.\n' +
                '- في حال فتح تكت غير مرتبط بالموضوع.\n' +
                '- يمنع الكذب والشتم والإهانة.\n' +
                '- لن يحل تكتك بعد مرور 24 ساعة من الشكوى.\n' +
                '- حسب الإساءة في الإهانة إلى المستخدم/الإداري داخل التكت.'
            )
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

        const select = new StringSelectMenuBuilder()
            .setCustomId('ticket_select_tik')
            .setPlaceholder('اختر نوع التقديم')
            .addOptions([
                { label: 'تقديم على 𝘛𝘪𝘬', value: 'tik' },
                { label: 'Application for 𝘛𝘪𝘬', value: 'tik_en' },
                { label: 'تقديم على 𝘚𝘵𝘳𝘦', value: 'stre' },
                { label: 'Application for 𝘚𝘵𝘳𝘦', value: 'stre_en' },
            ]);
        const row = new ActionRowBuilder().addComponents(select);
        await channel.send({ embeds: [embed], components: [row] });
    }
}
client.once('ready', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);

        for (const [, guild] of client.guilds.cache) {
        await registerClearCommand(guild);

        await snapshotGuild(guild).catch((error) => {
            console.log(`[SNAPSHOT ERR] ${error.message}`);
        });

        await guild.members.fetch().catch(() => {});

        for (const [, member] of guild.members.cache) {
            await assignUnverifiedIfNoRoles(member, 'Startup scan: member has no roles');
        }
    }
    console.log('[Bot] Protection active');
    console.log('[Bot] Verify active');
    console.log('[Bot] Avatar separator active');
    console.log('[Bot] Clear command active');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
        const content = message.content.trim();
        if (content.startsWith('!join-voice')) {
        const channelId = content.split(/\s+/)[1] ?? message.member?.voice?.channelId;

        if (!channelId) {
            await message.reply('اكتب ايدي الروم الصوتي أو ادخل روم واكتب الأمر.');
            return;
        }

        await joinBotVoiceChannel(message, channelId);
        await message.delete().catch(() => {});
        return;
    }

    if (content === '!leave-voice') {
        await leaveBotVoiceChannel(message);
        await message.delete().catch(() => {});
        return;
    }

    if (content === '!setup-ticket') {
        await sendTicketPanel(message.channel, 'general');
        await message.delete().catch(() => {});
        return;
    }
        if (content === '!setup-ticket-2') {
        await sendTicketPanel(message.channel, 'general_2');
        await message.delete().catch(() => {});
        return;
    }
        if (content === '!setup-ticket-rank') {
        await sendTicketPanel(message.channel, 'rank');
        await message.delete().catch(() => {});
        return;
    }

    if (content === '!setup-ticket-tik') {
        await sendTicketPanel(message.channel, 'tik');
        await message.delete().catch(() => {});
        return;
    }
    
    if (content === '!setup-ticket-buy') {
        await sendTicketPanel(message.channel, 'buy');
        await message.delete().catch(() => {});
        return;
    }

    if (content === '!setup-ticket-sub') {
        await sendTicketPanel(message.channel, 'sub');
        await message.delete().catch(() => {});
        return;
    }
    
    if (content === '!ticketstats') {
        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !hasAnyRole(member, SEND_COMMAND_ROLE_IDS)) {
            await message.reply('ما عندك صلاحية.').catch(() => {});
            return;
        }
               const stats = ticketStats.get(message.guild.id) ?? {};
        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        const lines = [
            `📂 **General**: ${stats[TICKET_CATEGORY_GENERAL_ID] ?? 0}`,
            `📂 **General 2**: ${stats[TICKET_CATEGORY_GENERAL_2_ID] ?? 0}`,
            `📂 **Tik**: ${stats[TICKET_CATEGORY_TIK_ID] ?? 0}`,
            `📂 **Stre**: ${stats[TICKET_CATEGORY_STRE_ID] ?? 0}`,
            `📂 **Rank**: ${stats[TICKET_CATEGORY_RANK_ID] ?? 0}`,
            `📂 **Buy**: ${stats[TICKET_CATEGORY_BUY_ID] ?? 0}`,
            `📂 **Sub**: ${stats[TICKET_CATEGORY_SUB_ID] ?? 0}`,
        ];
        const claims = ticketClaimStats.get(message.guild.id) ?? {};
        const sortedClaims = Object.entries(claims).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const claimLines = sortedClaims.length
            ? sortedClaims.map(([userId, count], i) => `${i + 1}. <@${userId}> — **${count}** استلام`).join('\n')
            : 'لا يوجد استلامات بعد.';
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('📊 إحصائيات التذاكر')
            .setDescription(
                lines.join('\n') +
                `\n─────────────\n**الإجمالي:** ${total} تذكرة\n\n` +
                `👤 **أكثر الأداريين استلاماً:**\n${claimLines}`
            )
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });
        await message.channel.send({ embeds: [embed] }).catch(() => {});
        await message.delete().catch(() => {});
        return;
    }

    if (content === RATING_TRIGGER_KEYWORD) {
        const ratingMember = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (ratingMember && ratingMember.roles.cache.some((role) => RATING_TRIGGER_ROLE_IDS.has(role.id))) {
            await message.delete().catch(() => {});
            await message.channel.send('"وجّه رسالة لمن سيشتري بعدك (تقييم)"\n\n@here').catch(() => {});
            return;
        }
    }
        if (messageCache.size >= 1000) messageCache.delete(messageCache.keys().next().value);
    messageCache.set(message.id, {
        content: message.content,
        authorId: message.author.id,
        authorTag: message.author.tag,
        channelName: message.channel.name ?? message.channel.id,
        attachments: [...message.attachments.values()].map(a => a.name ?? a.url),
    });

    if (message.channel.id !== MESSAGE_LOG_CHANNEL_ID) {
        const logCh = message.guild.channels.cache.get(MESSAGE_LOG_CHANNEL_ID)
            ?? await message.guild.channels.fetch(MESSAGE_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) {
            const attList = [...message.attachments.values()].map(a => a.name ?? a.url);
            const msgEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
                .setTitle(`Message in #${message.channel.name}`)
                .setDescription(message.content || '(no text)')
                .setFooter({ text: `ID: ${message.author.id}` })
                .setTimestamp();
            if (attList.length > 0) msgEmbed.addFields({ name: 'Attachments', value: attList.join('\n') });
            await logCh.send({ embeds: [msgEmbed] }).catch(() => {});
        }
    }
                if (message.channel.id === VIDEO_REACTION_CHANNEL_ID || message.channel.id === VIDEO_REACTION_CHANNEL_2_ID || message.channel.id === VIDEO_REACTION_CHANNEL_ALLOW_IMAGES_ID) {
        const allowImages = message.channel.id === VIDEO_REACTION_CHANNEL_ALLOW_IMAGES_ID;

        const hasVideo = message.attachments.some((attachment) =>
            attachment.contentType?.startsWith('video/') ||
            /\.(mp4|mov|webm|mkv|avi)$/i.test(attachment.name ?? attachment.url)
        );

        const hasImage = message.attachments.some((attachment) =>
            attachment.contentType?.startsWith('image/') ||
            /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.name ?? attachment.url)
        );

        if (message.author.id === OWNER_ID) {
            if (hasVideo) {
                for (const emoji of VIDEO_REACTIONS) {
                    await message.react(emoji).catch((err) => {
                        console.log(`[VIDEO REACT ERR] ${emoji} — ${err.message}`);
                    });
                }
            }

            return;
        }

        const textWithoutMentions = message.content
            .replace(/<@!?\d+>/g, '')
            .replace(/<@&\d+>/g, '')
            .replace(/<#\d+>/g, '')
            .replace(/@everyone|@here/g, '')
            .trim();

        const hasRealText = textWithoutMentions.length > 0;
        const hasAllowedMedia = hasVideo || (allowImages && hasImage);

        if (!hasAllowedMedia || hasRealText) {
            await message.delete().catch(() => {});

            const member = await message.guild.members.fetch(message.author.id).catch(() => null);

            if (member) {
                await member.timeout(MEDIA_ONLY_TIMEOUT_MS, 'روم مخصص للوسائط فقط').catch((err) => {
                    console.log(`[VIDEO ONLY TIMEOUT ERR] ${err.message}`);
                });
            }

            const timeoutReason = hasRealText
                ? 'ارسال كتابه في روم كليب'
                : (hasImage && !allowImages)
                ? 'ارسال صوره في روم كليب'
                : 'ارسال منشن في روم كليب';

            const timeoutNotifChannel = message.guild.channels.cache.get(TIMEOUT_LOG_CHANNEL_ID);
            if (timeoutNotifChannel && timeoutNotifChannel.isTextBased()) {
                await timeoutNotifChannel.send(
                    `@here\n\nperson : <@${message.author.id}>\n\nthe reason : ${timeoutReason}\n\nID : ${message.author.id}`
                ).catch(() => {});
            }

            return;
        }

        if (hasVideo) {
            for (const emoji of VIDEO_REACTIONS) {
                await message.react(emoji).catch((err) => {
                    console.log(`[VIDEO REACT ERR] ${emoji} — ${err.message}`);
                });
            }
        }
                            if (message.channel.id === VIDEO_REACTION_CHANNEL_ID) {
            await wait(700);
            await message.channel.send({ files: [AVATAR_SEPARATOR_FILE] }).catch(() => {});
        }

        return;
    }
    
    if (LINK_REGEX.test(message.content) && message.author.id !== OWNER_ID && !LINK_ALLOWED_CHANNEL_IDS.has(message.channel.id)) {

        return;
    }
    
if (LINK_REGEX.test(message.content) && message.author.id !== OWNER_ID && !LINK_ALLOWED_CHANNEL_IDS.has(message.channel.id)) {
        try {
            await message.delete().catch(() => {});
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member) {
                await member.timeout(ONE_WEEK_MS, 'إرسال رابط').catch(() => {});
            }
                                    const linkNotifChannel = message.guild.channels.cache.get(TIMEOUT_LOG_CHANNEL_ID);
            if (linkNotifChannel && linkNotifChannel.isTextBased()) {
                await linkNotifChannel.send(
                    `@here\n\nperson : <@${message.author.id}>\n\nthe reason : ارسال رابط\n\nID : ${message.author.id}`
                ).catch(() => {});
            }
        } catch (err) {
            console.log(`[LINK TIMEOUT ERR] ${err.message}`);
        }
        return;
    }
            if (await handleSenddCommand(message)) return;

        if (await handleSendCommand(message)) return;

    if (message.author.id === OWNER_ID) {
        if (await handleVerifyMessageCommand(message)) return;
    }

        if (VOICE_TRANSLATE_CHANNEL_IDS.has(message.channel.id) && message.content.trim().length > 0) {
        await handleTranslateMessage(message);
    }

    await handleAvatarSeparator(message);
});
async function createTicket(interaction, value, categoryId) {
    const guild = interaction.guild;
    const user = interaction.user;

    const existing = [...activeTickets.entries()].find(
        ([, d]) => d.creatorId === user.id && d.categoryId === categoryId
    );

    if (existing) {
        await interaction.reply({ content: `عندك تذكرة مفتوحة: <#${existing[0]}>`, ephemeral: true });
        return;
    }

    const num = (ticketCounters.get(guild.id) ?? 0) + 1;
    ticketCounters.set(guild.id, num);
    incrementTicketStat(guild.id, categoryId);

    const channelName = `${value.replace(/_/g, '-')}-${String(num).padStart(4, '0')}`;
    const claimRoleIds = TICKET_CLAIM_ROLE_CONFIG[categoryId] ?? GENERAL_TICKET_CLAIM_ROLE_IDS;

    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
            ],
        },
    ];

    for (const roleId of claimRoleIds) {
        overwrites.push({
            id: roleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
            ],
        });
    }

    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: overwrites,
        reason: `Ticket by ${user.tag}`,
    }).catch((err) => {
        console.log(`[TICKET ERR] ${err.message}`);
        return null;
    });

    if (!ticketChannel) {
        await interaction.reply({ content: 'فشل إنشاء التذكرة، تأكد من صلاحيات البوت.', ephemeral: true });
        return;
    }
        markBotAction(channelKey(guild.id, ticketChannel.id));
    saveChannel(ticketChannel);
    await moveChannelToCategoryBottom(ticketChannel);

    activeTickets.set(ticketChannel.id, {
        creatorId: user.id,
        type: value,
        categoryId,
        claimed: false,
        claimedBy: null,
    });

    const member = await guild.members.fetch(user.id).catch(() => null);
    const displayName = member?.displayName ?? user.username;

    const welcomeEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('تم فتح التذكرة بنجاح')
        .setDescription(
            `سيتم التواصل معك من قبل مسؤولين قريباً... شكرين لصبر تفهمكم.\n` +
            `راجع القوانين.\n` +
            `اسمك : **${displayName}**\n` +
            `خيارك : **${value.replace(/_/g, ' ')}**`
        )
        .addFields({ name: '# . Rules', value: '@everyone' })
        .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

    const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger);
    const claimBtn = new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(closeBtn, claimBtn);

    await ticketChannel.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed], components: [row] });
    await interaction.reply({ content: `✅ تم فتح تذكرتك: <#${ticketChannel.id}>`, ephemeral: true });
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== CLEAR_COMMAND_NAME) return;

    const clearMember = interaction.member ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (interaction.user.id !== OWNER_ID && !(clearMember && clearMember.roles.cache.has('1490156350896996413'))) {
        await interaction.reply({
            content: 'هذا الأمر للمالك فقط.',
            ephemeral: true,
        }).catch(() => {});
        return;
    }

    const amount = interaction.options.getInteger('amount');

    if (!amount || amount < 1 || amount > MAX_CLEAR_AMOUNT) {
        await interaction.reply({
            content: 'حدد رقم من 1 إلى 1000.',
            ephemeral: true,
        }).catch(() => {});
        return;
    }

    if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.reply({
            content: 'هذا الأمر يشتغل في الرومات الكتابية فقط.',
            ephemeral: true,
        }).catch(() => {});
        return;
    }

    await interaction.reply({
        content: `جاري حذف ${amount} رسالة...`,
        ephemeral: true,
    }).catch(() => {});

    try {
        const deletedTotal = await clearMessages(interaction, amount);

        await interaction.followUp({
            content: `تم حذف ${deletedTotal} رسالة. إذا العدد أقل، فبعض الرسائل قديمة أكثر من 14 يوم أو ما عندي صلاحية حذفها.`,
            ephemeral: true,
        }).catch(() => {});
    } catch (error) {
        await interaction.followUp({
            content: `صار خطأ أثناء الحذف: ${error.message}`,
            ephemeral: true,
        }).catch(() => {});
    }
});
client.on('interactionCreate', async (interaction) => {
    // ───────────── أزرار ─────────────
    if (interaction.isButton()) {
        const id = interaction.customId;

        // زر فتح تذكرة عامة
        if (id === 'open_ticket_general') {
            const select = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_general')
                .setPlaceholder('اختر نوع التذكرة')
                .addOptions([
                    { label: 'تقديم اداره',  value: 'تقديم_اداره' },
                    { label: 'مشكله',        value: 'مشكله' },
                    { label: 'استفسار',      value: 'استفسار' },
                    { label: 'Application for an administrative position', value: 'admin_application' },
                    { label: 'Issue',        value: 'issue' },
                    { label: 'Inquiry',      value: 'inquiry' },
                ]);
            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ content: 'اختر نوع التذكرة:', components: [row], ephemeral: true });
            return;
        }
                if (id === 'open_ticket_general_2') {
            const select = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_general_2')
                .setPlaceholder('اختر نوع التذكرة')
                .addOptions([
                    { label: 'تقديم اداره',  value: 'تقديم_اداره' },
                    { label: 'مشكله',        value: 'مشكله' },
                    { label: 'استفسار',      value: 'استفسار' },
                    { label: 'Application for an administrative position', value: 'admin_application' },
                    { label: 'Issue',        value: 'issue' },
                    { label: 'Inquiry',      value: 'inquiry' },
                ]);

            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ content: 'اختر نوع التذكرة:', components: [row], ephemeral: true });
            return;
        }

        // زر فتح تذكرة تقديم
        if (id === 'open_ticket_tik') {
            const select = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_tik')
                .setPlaceholder('اختر نوع التقديم')
                .addOptions([
                    { label: 'تقديم على 𝘛𝘪𝘬', value: 'tik' },
                    { label: 'تقديم على 𝘚𝘵𝘳𝘦', value: 'stre' },
                    { label: 'Application for 𝘛𝘪𝘬', value: 'tik_en' },
                    { label: 'Application for 𝘚𝘵𝘳𝘦', value: 'stre_en' },
                ]);
            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ content: 'اختر نوع التقديم:', components: [row], ephemeral: true });
            return;
        }

        // زر Close
        if (id === 'close_ticket') {
            const ticketData = activeTickets.get(interaction.channelId);
            if (ticketData) {
                await interaction.channel.permissionOverwrites.edit(ticketData.creatorId, {
                    SendMessages: false,
                }).catch(() => {});
            }

            const openBtn   = new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Open').setStyle(ButtonStyle.Success);
            const deleteBtn = new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(openBtn, deleteBtn);

           await interaction.reply({ content: '🔒 تم إغلاق التذكرة. اختر إجراء:', components: [row] });
            await interaction.channel.send('🔒 **تم إغلاق التذكرة.**').catch(() => {});
            return;
        }

        // زر Open (إعادة فتح)
        if (id === 'ticket_reopen') {
            const ticketData = activeTickets.get(interaction.channelId);
            if (ticketData) {
                await interaction.channel.permissionOverwrites.edit(ticketData.creatorId, {
                    SendMessages: true,
                    ViewChannel: true,
                }).catch(() => {});
            }
            await interaction.reply({ content: '✅ تم إعادة فتح التذكرة.', ephemeral: true });
            await interaction.channel.send('🔓 **تم إعادة فتح التذكرة.**').catch(() => {});
            return;
        }

        // زر Delete
       if (id === 'ticket_delete') {
    await interaction.reply({ content: 'جاري حذف التذكرة...' }).catch(() => {});
    activeTickets.delete(interaction.channelId);
    await interaction.channel.delete().catch(() => {});
    return;
}

        // زر Claim
               if (id === 'ticket_claim') {
            const ticketData = activeTickets.get(interaction.channelId);

            if (!ticketData) {
                await interaction.reply({ content: 'هذه ليست تذكرة نشطة.', ephemeral: true });
                return;
            }

            const allowedRoles = TICKET_CLAIM_ROLE_CONFIG[ticketData.categoryId] ?? GENERAL_TICKET_CLAIM_ROLE_IDS;

            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const canClaim = member?.roles.cache.some((role) => allowedRoles.has(role.id));

            if (!canClaim) {
                await interaction.reply({ content: 'ما عندك صلاحية تستلم هذه التذكرة.', ephemeral: true });
                return;
            }

            if (ticketData.claimed) {
                await interaction.reply({ content: `التذكرة محجوزة بالفعل بواسطة <@${ticketData.claimedBy}>.`, ephemeral: true });
                return;
            }

            ticketData.claimed = true;
            ticketData.claimedBy = interaction.user.id;
            incrementTicketClaim(interaction.guild.id, interaction.user.id);

            const claimLog = interaction.guild.channels.cache.get(TICKET_CLAIM_LOG_CHANNEL_ID)
                ?? await interaction.guild.channels.fetch(TICKET_CLAIM_LOG_CHANNEL_ID).catch(() => null);

            if (claimLog) {
                await claimLog.send(
                    `<@${interaction.user.id}> استلم التذكرة <#${interaction.channelId}>`
                ).catch(() => {});
            }

            await interaction.reply({ content: `✅ تم استلام التذكرة بواسطة <@${interaction.user.id}>.` });
            return;
        }
        
    }

    // ───────────── قوائم الاختيار ─────────────
    if (interaction.isStringSelectMenu()) {
        const id    = interaction.customId;
        const value = interaction.values[0];

       if (id !== 'ticket_select_general' && id !== 'ticket_select_general_2' && id !== 'ticket_select_tik' && id !== 'ticket_select_rank' && id !== 'ticket_select_buy' && id !== 'ticket_select_sub') return;

                   const categoryId =
            id === 'ticket_select_tik'
                ? ((value === 'stre' || value === 'stre_en') ? TICKET_CATEGORY_STRE_ID : TICKET_CATEGORY_TIK_ID)
                : id === 'ticket_select_general_2'
                    ? TICKET_CATEGORY_GENERAL_2_ID
                    : id === 'ticket_select_rank'
                        ? TICKET_CATEGORY_RANK_ID
                        : id === 'ticket_select_buy'
                            ? TICKET_CATEGORY_BUY_ID
                            : id === 'ticket_select_sub'
                                ? TICKET_CATEGORY_SUB_ID
                                : TICKET_CATEGORY_GENERAL_ID;
        const guild = interaction.guild;
        const user  = interaction.user;

        // تحقق إن المستخدم ما عنده تذكرة مفتوحة في نفس الكاتوقري
        const existing = [...activeTickets.entries()].find(
            ([, d]) => d.creatorId === user.id && d.categoryId === categoryId
        );
        if (existing) {
            await interaction.reply({ content: `عندك تذكرة مفتوحة: <#${existing[0]}>`, ephemeral: true });
            return;
        }

        // رقم التذكرة
        const num = (ticketCounters.get(guild.id) ?? 0) + 1;
        ticketCounters.set(guild.id, num);
        incrementTicketStat(guild.id, categoryId);
        const channelName = `${value.replace(/_/g, '-')}-${String(num).padStart(4, '0')}`;

     // صلاحيات القناة
        const claimRoleIds = TICKET_CLAIM_ROLE_CONFIG[categoryId] ?? GENERAL_TICKET_CLAIM_ROLE_IDS;
        const overwrites = [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
                id: user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                ],
            },
        ];
        for (const roleId of claimRoleIds) {
            overwrites.push({
                id: roleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages,
                ],
            });
        }

        // إنشاء قناة التذكرة
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: overwrites,
            reason: `Ticket by ${user.tag}`,
        }).catch((err) => { console.log(`[TICKET ERR] ${err.message}`); return null; });

        if (!ticketChannel) {
            await interaction.reply({ content: 'فشل إنشاء التذكرة، تأكد من صلاحيات البوت.', ephemeral: true });
            return;
        }
                markBotAction(channelKey(guild.id, ticketChannel.id));
        saveChannel(ticketChannel);
        await moveChannelToCategoryBottom(ticketChannel);

        activeTickets.set(ticketChannel.id, { creatorId: user.id, type: value, categoryId, claimed: false, claimedBy: null });

        // الإمبد داخل التذكرة
        const member = await guild.members.fetch(user.id).catch(() => null);
        const displayName = member?.displayName ?? user.username;

        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('تم فتح التذكرة بنجاح')
            .setDescription(
                `سيتم التواصل معك من قبل مسؤولين قريباً... شكرين لصبر تفهمكم.\n` +
                `راجع القوانين.\n` +
                `اسمك : **${displayName}**\n` +
                `خيارك : **${value.replace(/_/g, ' ')}**`
            )
            .addFields({ name: '# . Rules', value: '@everyone' })
            .setFooter({ text: '𝟎𝟖 – Ticketing without clutter' });

        const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger);
        const claimBtn = new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder().addComponents(closeBtn, claimBtn);

        await ticketChannel.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed], components: [row] });
        await interaction.reply({ content: `✅ تم فتح تذكرتك: <#${ticketChannel.id}>`, ephemeral: true });
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        if (reaction.message.channel.id !== VERIFY_CHANNEL_ID) return;
        if (reaction.emoji.name !== VERIFY_EMOJI) return;

        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);

        const verifyRole = guild.roles.cache.get(VERIFY_ROLE_ID);
        const unverifiedRole = guild.roles.cache.get(UNVERIFIED_ROLE_ID);

        if (!verifyRole) {
            await sendLog(guild, `رتبة التفعيل غير موجودة: ${VERIFY_ROLE_ID}`);
            return;
        }

        const key = memberKey(guild.id, member.id);

        markBotAction(key);

        if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.remove(unverifiedRole, 'Verification remove unverified').catch(() => {});
        }

        if (!member.roles.cache.has(verifyRole.id)) {
            await member.roles.add(verifyRole, 'Verification add verified').catch(() => {});
        }

        const updated = await guild.members.fetch(user.id).catch(() => member);

        saveMember(updated);
        saveRole(verifyRole);
        if (unverifiedRole) saveRole(unverifiedRole);

        await sendLog(guild, `تم تفعيل العضو <@${member.id}>`);
    } catch (error) {
        console.log(`[VERIFY ERR] ${error.message}`);
    }
});

client.on('roleCreate', async (role) => {
    if (role.managed) return;

    const key = roleKey(role.guild.id, role.id);

       if ((restoringRoles.get(role.guild.id) ?? 0) > 0 || isBotAction(key)) {
        saveRole(role);
        return;
    }

    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveRole(role);
        return;
    }

    markBotAction(key);

    await role.delete('Protection rollback: unauthorized role create').catch(() => {});

    roleSnapshots.delete(key);

    await sendLog(role.guild, `حذفت رتبة جديدة غير مصرح بها: ${role.name}`);
    await punish(role.guild, executor, 'اضافة رتبه جديده');
});

client.on('roleDelete', async (role) => {
    const key = roleKey(role.guild.id, role.id);

    if (isBotAction(key)) {
        roleSnapshots.delete(key);
        return;
    }

    const storedSnapshot = roleSnapshots.get(key);

    const snapshot = storedSnapshot ?? {
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        rawPosition: role.rawPosition,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        memberIds: [],
    };

    // Collect member IDs from every available source and take their UNION.
    //
    // Source 1 — memberRoleSnapshots (most reliable):
    const trackedIds = getMembersWithRole(role.guild.id, role.id);

    // Source 2 — live role.members:
    const liveIds = [...role.members.keys()];

    // Source 3 — guild member cache scan:
    const cacheIds = [...role.guild.members.cache.values()]
        .filter((m) => m.roles.cache.has(role.id))
        .map((m) => m.id);

    // Source 4 — stored snapshot:
    const storedIds = storedSnapshot?.memberIds ?? [];

    // Source 5 — deletedRoleMemberBuffer:
    const bufferedIds = [...(deletedRoleMemberBuffer.get(role.id) ?? [])];

    // Union all sources so we never miss a member regardless of event order
    const allIds = new Set([...trackedIds, ...liveIds, ...cacheIds, ...storedIds, ...bufferedIds]);
    snapshot.memberIds = [...allIds];

    console.log(`[ROLE DELETE] ${snapshot.name} — tracked=${trackedIds.length} live=${liveIds.length} cache=${cacheIds.length} stored=${storedIds.length} buffer=${bufferedIds.length} final=${snapshot.memberIds.length}`);
    console.log(`[ROLE DELETE] buffer keys: ${[...deletedRoleMemberBuffer.keys()].join(',')} | roleId=${role.id}`);

    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        roleSnapshots.delete(key);
        deletedRoleMemberBuffer.delete(role.id);
        return;
    }

    const recreated = await restoreDeletedRole(role.guild, role.id, snapshot);

    if (recreated) {
        await sendLog(role.guild, `رجعت رتبة محذوفة: ${snapshot.name} — وأرجعتها لـ ${snapshot.memberIds.length} عضو`);
    } else {
        await sendLog(role.guild, `فشلت أرجع الرتبة المحذوفة: ${snapshot.name}`);
    }

    await punish(role.guild, executor, 'حذف رتبه');
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (newRole.managed) return;

    const key = roleKey(newRole.guild.id, newRole.id);

    if (isBotAction(key)) {
        saveRole(newRole);
        return;
    }

    const snapshot = roleSnapshots.get(key);

    if (!snapshot) {
        saveRole(newRole);
        return;
    }

    const positionChanged = newRole.rawPosition !== snapshot.rawPosition;
    const propsChanged =
        newRole.name !== snapshot.name ||
        newRole.color !== snapshot.color ||
        newRole.hoist !== snapshot.hoist ||
        newRole.mentionable !== snapshot.mentionable ||
        newRole.permissions.bitfield.toString() !== snapshot.permissions;

    if (!positionChanged && !propsChanged) return;

    // Position-only change handling — no audit log, rely only on saved snapshot.
    // isBotAction at the top already handles the bot's own setPosition calls.
    // restoringPositions guards against cascade side-effects.
    if (positionChanged && !propsChanged) {
        if (restoringPositions.has(newRole.guild.id)) {
            saveRole(newRole);
            return;
        }

        markBotAction(key);
        restoringPositions.add(newRole.guild.id);

        await newRole.setPosition(snapshot.rawPosition, { relative: false }).catch((err) => {
            console.log(`[RESTORE POS ERR] ${snapshot.name} — ${err.message}`);
        });

        await wait(3000);
        restoringPositions.delete(newRole.guild.id);

        const freshRoles = await newRole.guild.roles.fetch().catch(() => null);
        if (freshRoles) {
            for (const [, freshRole] of freshRoles) {
                if (!freshRole.managed) {
                    saveRole(freshRole);
                }
            }
        }

        await sendLog(newRole.guild, `رجعت مكان رتبة: ${snapshot.name}`);
        return;
    }

    // Properties changed (with or without position change)
       markBotAction(key);

    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveRole(newRole);
        return;
    }

    await newRole.edit({
        name: snapshot.name,
        color: snapshot.color,
        hoist: snapshot.hoist,
        mentionable: snapshot.mentionable,
        permissions: BigInt(snapshot.permissions),
    }, 'Protection rollback role').catch(() => {});

    if (positionChanged) {
        await newRole.setPosition(snapshot.rawPosition, { relative: false }).catch((err) => {
            console.log(`[RESTORE POS ERR] ${snapshot.name} — ${err.message}`);
        });
    }

    await sendLog(newRole.guild, `رجعت تغيير رتبة: ${snapshot.name}`);
    await punish(newRole.guild, executor, 'تعديل رتبه');
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
         if (
        (
            channel.parentId === TICKET_CATEGORY_GENERAL_ID ||
            channel.parentId === TICKET_CATEGORY_GENERAL_2_ID ||
            channel.parentId === TICKET_CATEGORY_TIK_ID ||
            channel.parentId === TICKET_CATEGORY_STRE_ID ||
            channel.parentId === TICKET_CATEGORY_RANK_ID ||
            channel.parentId === TICKET_CATEGORY_BUY_ID ||
            channel.parentId === TICKET_CATEGORY_SUB_ID
        ) &&
        /-\d{4}$/.test(channel.name)
    ) {
        saveChannel(channel);
        return;
    }

    const key = channelKey(channel.guild.id, channel.id);

    if (restoringChannels.has(channel.guild.id) || isBotAction(key)) {
        saveChannel(channel);
        return;
    }

    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveChannel(channel);
        return;
    }

    markBotAction(key);

    await channel.delete('Protection rollback: unauthorized channel create').catch(() => {});

    channelSnapshots.delete(key);

    await sendLog(channel.guild, `حذفت روم جديد غير مصرح به: ${channel.name}`);
    await punish(channel.guild, executor, 'اضافة روم');
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;

    const key = channelKey(channel.guild.id, channel.id);

    if (isBotAction(key)) {
        channelSnapshots.delete(key);
        return;
    }

    const snapshot = channelSnapshots.get(key);

    if (!snapshot) return;
            if (
        snapshot.parentId === TICKET_CATEGORY_GENERAL_ID ||
        snapshot.parentId === TICKET_CATEGORY_GENERAL_2_ID ||
        snapshot.parentId === TICKET_CATEGORY_TIK_ID ||
        snapshot.parentId === TICKET_CATEGORY_STRE_ID ||
        snapshot.parentId === TICKET_CATEGORY_RANK_ID ||
        snapshot.parentId === TICKET_CATEGORY_BUY_ID ||
        snapshot.parentId === TICKET_CATEGORY_SUB_ID
    ) {
        channelSnapshots.delete(key);
        activeTickets.delete(channel.id);
        return;
    }

    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        channelSnapshots.delete(key);
        return;
    }

    const recreated = await restoreDeletedChannel(channel.guild, snapshot);

    if (recreated) {
        await sendLog(channel.guild, `رجعت روم محذوف: ${snapshot.name}`);
    } else {
        await sendLog(channel.guild, `فشلت أرجع الروم المحذوف: ${snapshot.name}`);
    }

    await punish(channel.guild, executor, snapshot.type === ChannelType.GuildCategory ? 'حذف كاتوقري' : 'حذف روم');
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    const key = channelKey(newChannel.guild.id, newChannel.id);

    if (restoringChannels.has(newChannel.guild.id) || isBotAction(key) || channelUpdateLocked(key)) {
        saveChannel(newChannel);
        return;
    }

    const snapshot = channelSnapshots.get(key);

    if (!snapshot) {
        saveChannel(newChannel);
        return;
    }

    const currentOverwrites = JSON.stringify(channelOverwrites(newChannel));
    const oldOverwrites = JSON.stringify(snapshot.permissionOverwrites);

    const changed =
        newChannel.name !== snapshot.name ||
        (newChannel.parentId ?? null) !== snapshot.parentId ||
        currentOverwrites !== oldOverwrites ||
        ('topic' in newChannel && newChannel.topic !== snapshot.topic) ||
        ('nsfw' in newChannel && newChannel.nsfw !== snapshot.nsfw) ||
        ('rateLimitPerUser' in newChannel && newChannel.rateLimitPerUser !== snapshot.rateLimitPerUser);

       if (!changed) return;

   markBotAction(key, CHANNEL_UPDATE_LOCK_MS);

    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveChannel(newChannel);
        return;
    }

    const editPayload = { name: snapshot.name };
    if ('topic' in newChannel) editPayload.topic = snapshot.topic ?? null;
    if ('nsfw' in newChannel) editPayload.nsfw = snapshot.nsfw;
    if ('rateLimitPerUser' in newChannel) editPayload.rateLimitPerUser = snapshot.rateLimitPerUser ?? 0;

    await newChannel.edit(editPayload, 'Protection rollback channel').catch(() => {});

    if ((newChannel.parentId ?? null) !== snapshot.parentId && newChannel.type !== ChannelType.GuildCategory) {
        await newChannel.setParent(snapshot.parentId, {
            lockPermissions: false,
            reason: 'Protection rollback channel parent',
        }).catch(() => {});
    }

    if (currentOverwrites !== oldOverwrites) {
        await newChannel.permissionOverwrites.set(toOverwrites(snapshot), 'Protection rollback channel permissions').catch(() => {});
    }

    if (!channelRestoreLogOnCooldown(newChannel.guild.id, executor?.id, 'تعديل روم')) {
    await sendLog(newChannel.guild, `رجعت تغيير روم: ${snapshot.name}`);
}
    await punish(newChannel.guild, executor, 'تعديل روم');
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
        const wasTimedOut = oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntil > new Date();
    const isNowTimedOut = newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date();

         if (!wasTimedOut && isNowTimedOut) {
        try {
            await wait(1000);
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
            const entry = [...auditLogs.entries.values()].find((e) =>
                e.target?.id === newMember.id && e.createdTimestamp >= Date.now() - 20000
            );

            const executor = entry?.executor ?? null;
            const auditReason = entry?.reason ?? 'غير معروف السبب';

            const msLeft = newMember.communicationDisabledUntil - new Date();
            const totalMinutes = Math.round(msLeft / 60000);
            const days = Math.floor(totalMinutes / 1440);
            const hours = Math.floor((totalMinutes % 1440) / 60);
            const mins = totalMinutes % 60;
            const durationText = days > 0 ? `${days} يوم` : hours > 0 ? `${hours} ساعة` : `${mins} دقيقة`;

            const givenBy = executor
                ? (executor.id === client.user?.id ? 'البوت' : `<@${executor.id}>`)
                : 'غير معروف';

            let timeoutCh = newMember.guild.channels.cache.get(TIMEOUT_LOG_CHANNEL_ID);
            if (!timeoutCh) timeoutCh = await newMember.guild.channels.fetch(TIMEOUT_LOG_CHANNEL_ID).catch((e) => { console.log(`[TIMEOUT CH FETCH ERR] ${e.message}`); return null; });

            if (!timeoutCh) { console.log(`[TIMEOUT] channel not found: ${TIMEOUT_LOG_CHANNEL_ID}`); }
            else await timeoutCh.send(`@here\n\nperson : <@${newMember.id}>\n\nthe reason : ${auditReason}\n\nID : ${newMember.id}\n\nأعطاه التايم اوت : ${givenBy}\n\nالمدة : ${durationText}`).catch((e) => console.log(`[TIMEOUT SEND ERR] ${e.message}`));
        } catch (err) {
            console.log(`[TIMEOUT DETECT ERR] ${err.message}`);
        }
    } else if (wasTimedOut && !isNowTimedOut) {
        try {
            await wait(1000);
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
            const entry = [...auditLogs.entries.values()].find((e) =>
                e.target?.id === newMember.id && e.createdTimestamp >= Date.now() - 20000
            );
            const remover = entry?.executor ?? null;
            const removedBy = remover
                ? (remover.id === client.user?.id ? 'البوت' : `<@${remover.id}>`)
                : 'غير معروف';

            let timeoutCh = newMember.guild.channels.cache.get(TIMEOUT_LOG_CHANNEL_ID);
            if (!timeoutCh) timeoutCh = await newMember.guild.channels.fetch(TIMEOUT_LOG_CHANNEL_ID).catch((e) => { console.log(`[TIMEOUT CH FETCH ERR] ${e.message}`); return null; });

            if (timeoutCh) await timeoutCh.send(`person : <@${newMember.id}>\n\nتم فك التايم اوت بواسطة : ${removedBy}\n\nID : ${newMember.id}`).catch((e) => console.log(`[TIMEOUT REMOVE SEND ERR] ${e.message}`));
        } catch (err) {
            console.log(`[TIMEOUT REMOVE ERR] ${err.message}`);
        }
    }
    const newRoleIds = new Set([...newMember.roles.cache.keys()]);


    // Use oldMember roles if available, otherwise fall back to our stored snapshot
    // (oldMember can be partial with empty roles cache)
    let oldRoleIds;
    const storedRoles = memberRoleSnapshots.get(memberKey(newMember.guild.id, newMember.id));
    if (!oldMember.partial && oldMember.roles.cache.size > 0) {
        oldRoleIds = [...oldMember.roles.cache.keys()];
    } else if (storedRoles && storedRoles.size > 0) {
        oldRoleIds = [...storedRoles];
    } else {
        oldRoleIds = [];
    }
            // لوق إضافة/سحب الرتب
    const roleLogChannel = newMember.guild.channels.cache.get(ROLE_LOG_CHANNEL_ID);
    if (roleLogChannel && roleLogChannel.isTextBased()) {
        const oldRoleSet = storedRoles ?? new Set();
        const added = [...newMember.roles.cache.keys()].filter(id => id !== newMember.guild.id && !oldRoleSet.has(id));
        const removed = [...(storedRoles ?? new Set())].filter(id => id !== newMember.guild.id && !newRoleIds.has(id));

        if (added.length > 0 || removed.length > 0) {
            const executor = await getAuditExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id, true);
            const executorText = executor ? `بواسطة <@${executor.id}>` : 'بواسطة غير معروف';

            for (const roleId of added) {
                const role = newMember.guild.roles.cache.get(roleId);
                await roleLogChannel.send(`تمت إضافة رتبة **${role?.name ?? roleId}** لـ <@${newMember.id}> ${executorText}`).catch(() => {});
            }
            for (const roleId of removed) {
                const role = newMember.guild.roles.cache.get(roleId);
                await roleLogChannel.send(`تمت إزالة رتبة **${role?.name ?? roleId}** من <@${newMember.id}> ${executorText}`).catch(() => {});
            }
        }
    }

    for (const roleId of oldRoleIds) {
        if (roleId === newMember.guild.id) continue;
        if (!newRoleIds.has(roleId)) {
            if (!deletedRoleMemberBuffer.has(roleId)) {
                deletedRoleMemberBuffer.set(roleId, new Set());
            }
            deletedRoleMemberBuffer.get(roleId).add(newMember.id);
            console.log(`[BUFFER] Captured member ${newMember.id} for role ${roleId}`);
        }
    }

        await assignUnverifiedIfNoRoles(newMember, 'Auto-assign: member has no roles');
    
    if (newMember.roles.cache.has(UNVERIFIED_ROLE_ID)) {
        const otherRoles = newMember.roles.cache.filter(
            (role) => role.id !== newMember.guild.id && role.id !== UNVERIFIED_ROLE_ID
        );
        if (otherRoles.size > 0) {
            markBotAction(memberKey(newMember.guild.id, newMember.id));
            await newMember.roles.remove(UNVERIFIED_ROLE_ID, 'Has other roles, removing unverified').catch((err) => {
                console.log(`[REMOVE UNVERIFIED ERR] ${err.message}`);
            });
        }
    }
    saveMember(newMember);
});
client.on('guildBanAdd', async (ban) => {
    const guild = ban.guild;

    const executor = await getAuditExecutor(guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        return;
    }

    // فك البان عن الشخص اللي تبند
    await guild.members.unban(ban.user.id, 'Protection rollback: unauthorized ban').catch((err) => {
        console.log(`[UNBAN ERR] ${err.message}`);
    });

    await sendLog(guild, `فكيت بان غير مصرح به عن <@${ban.user.id}>`);

    // عقاب الشخص اللي سوى البان
    await punish(guild, executor, 'بان عضو بدون صلاحية');
});

const MEMBER_LOG_CHANNEL_ID = '1494797903754035332';

client.on('guildMemberAdd', async (member) => {
        if (member.user.bot && member.id !== client.user?.id) {
        const executor = await getAuditExecutor(member.guild, AuditLogEvent.BotAdd, member.id, true);
        await member.kick('حماية: لا يسمح بإضافة بوتات').catch(() => {});
        await sendLog(member.guild, `طردت بوت جديد: ${member.user.tag} (${member.id})`);
        if (executor && !isIgnored(executor.id, executor.bot)) {
            const executorMember = await member.guild.members.fetch(executor.id).catch(() => null);
            if (executorMember) {
                await executorMember.kick('حماية: إضافة بوت للسيرفر').catch(async (err) => {
                    await sendLog(member.guild, `ما قدرت أطرد ${executor.tag} — ${err.message}`);
                });
                await sendLog(member.guild, `طردت <@${executor.id}> بسبب إضافة بوت`);
            }
        }
        return;
    }
        await assignUnverifiedIfNoRoles(member, 'Member join: assign unverified role');
    try {
        const channel = member.guild.channels.cache.get(MEMBER_LOG_CHANNEL_ID)
            ?? await member.guild.channels.fetch(MEMBER_LOG_CHANNEL_ID).catch(() => null);
        if (!channel) { console.log('[JOIN] ما لقيت القناة: ' + MEMBER_LOG_CHANNEL_ID); return; }
        const memberCount = member.guild.memberCount;
        const createdAt = member.user.createdAt;
        const diffMs = Date.now() - createdAt;
        const diffDays = Math.floor(diffMs / 86400000);
        const years = Math.floor(diffDays / 365);
        const months = Math.floor((diffDays % 365) / 30);
        const days = diffDays % 30;
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .setTitle('Member joined')
            .setDescription(`<@${member.id}> ${memberCount}th to join\ncreated ${years} years, ${months} months and ${days} days ago`)
            .setFooter({ text: `ID: ${member.id}` })
            .setTimestamp();
      await channel.send({ embeds: [embed] }).catch((e) => console.log('[JOIN SEND ERR]', e.message));
    } catch (err) { console.log(`[JOIN LOG ERR] ${err.message}`); }
});

client.on('guildMemberRemove', async (member) => {
    try {
        const channel = member.guild.channels.cache.get(MEMBER_LOG_CHANNEL_ID)
            ?? await member.guild.channels.fetch(MEMBER_LOG_CHANNEL_ID).catch(() => null);
       if (!channel) { console.log('[LEAVE] ما لقيت القناة: ' + MEMBER_LOG_CHANNEL_ID); return; }
        const joinedAt = member.joinedAt;
        let joinedText = 'unknown';
        if (joinedAt) {
            const diffMs = Date.now() - joinedAt;
            const mins = Math.floor(diffMs / 60000);
            const hours = Math.floor(mins / 60);
            const days = Math.floor(hours / 24);
            if (days > 0) joinedText = `joined ${days} days ago`;
            else if (hours > 0) joinedText = `joined ${hours} hours and ${mins % 60} minutes ago`;
            else joinedText = `joined ${mins} minutes ago`;
        }
        const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(' · ') || 'None';
        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .setTitle('Member left')
            .setDescription(`<@${member.id}> ${joinedText}\nRoles: ${roles}`)
            .setFooter({ text: `ID: ${member.id}` })
            .setTimestamp();
        await channel.send({ embeds: [embed] }).catch((e) => console.log('[LEAVE SEND ERR]', e.message));
    } catch (err) { console.log(`[LEAVE LOG ERR] ${err.message}`); }
});
client.on('messageDelete', async (message) => {
    if (!message.guild) return;

    const cached = messageCache.get(message.id);
    messageCache.delete(message.id);

    if (!cached && message.author?.bot) return;

    const authorId = cached?.authorId ?? message.author?.id ?? null;
    const content = cached?.content ?? message.content ?? '';
    const channelName = cached?.channelName ?? message.channel?.name ?? 'unknown';
    const attachments = cached?.attachments ?? [...(message.attachments?.values() ?? [])].map(a => a.name ?? a.url);

    let deletedBy = null;
    try {
        await wait(1000);
        const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
        const entry = [...logs.entries.values()].find(e =>
            (!authorId || e.target?.id === authorId) &&
            e.createdTimestamp >= Date.now() - 15000
        );
        if (entry?.executor && entry.executor.id !== authorId) {
            deletedBy = entry.executor;
        }
    } catch {}

    const logChannel = message.guild.channels.cache.get(MESSAGE_LOG_CHANNEL_ID)
        ?? await message.guild.channels.fetch(MESSAGE_LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`Message deleted in #${channelName}`)
        .setDescription(content || '(no text)');

    if (authorId) embed.addFields({ name: 'Author', value: `<@${authorId}>` });
    if (deletedBy) embed.addFields({ name: 'Deleted by', value: `<@${deletedBy.id}>` });
    if (attachments.length > 0) embed.addFields({ name: 'Attachments', value: attachments.join('\n') });

    embed
        .addFields({ name: 'Message ID', value: message.id })
        .setFooter({ text: `ID: ${authorId ?? 'unknown'}` })
        .setTimestamp();

    await logChannel.send({ embeds: [embed] }).catch(() => {});
});
client.on('voiceStateUpdate', async (oldState, newState) => {
        {
        const member = newState.member ?? oldState.member;

        if (!member || member.user.bot) return;

        const voiceLogChannel = newState.guild.channels.cache.get(VOICE_LOG_CHANNEL_ID)
            ?? await newState.guild.channels.fetch(VOICE_LOG_CHANNEL_ID).catch(() => null);

        if (voiceLogChannel?.isTextBased()) {
            if (newState.channelId && oldState.channelId !== newState.channelId) {
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('دخول روم صوتي')
                    .addFields(
                        { name: 'الشخص', value: `<@${member.id}>`, inline: true },
                        { name: 'الروم', value: `<#${newState.channelId}>`, inline: true }
                    )
                    .setFooter({ text: `ID: ${member.id}` })
                    .setTimestamp();

                await voiceLogChannel.send({ embeds: [embed] }).catch(() => {});
            }
            
            if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                const moveLogs = await newState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberMove,
                    limit: 5,
                }).catch(() => null);

                const moveEntry = moveLogs?.entries.find((entry) =>
                    entry.executor?.id &&
                    entry.executor.id !== client.user?.id &&
                    entry.executor.id !== member.id &&
                    Date.now() - entry.createdTimestamp < 7000
                );

                if (moveEntry) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('سحب من روم لروم')
                        .addFields(
                            { name: 'اللي سحب', value: `<@${moveEntry.executor.id}>`, inline: true },
                            { name: 'اللي انسحب', value: `<@${member.id}>`, inline: true },
                            { name: 'من روم', value: `<#${oldState.channelId}>`, inline: true },
                            { name: 'إلى روم', value: `<#${newState.channelId}>`, inline: true }
                        )
                        .setFooter({ text: `ID: ${member.id}` })
                        .setTimestamp();

                    await voiceLogChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }
                        if (oldState.channelId && !newState.channelId) {
                const auditLogs = await newState.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberDisconnect,
                    limit: 5,
                }).catch(() => null);

                const disconnectEntry = auditLogs?.entries.find((entry) =>
                    entry.executor?.id &&
                    entry.executor.id !== client.user?.id &&
                    Date.now() - entry.createdTimestamp < 7000
                );

                if (disconnectEntry) {
                    const embed = new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('طرد من روم صوتي')
                        .addFields(
                            { name: 'اللي طرد', value: `<@${disconnectEntry.executor.id}>`, inline: true },
                            { name: 'اللي انطرد', value: `<@${member.id}>`, inline: true },
                            { name: 'الروم', value: `<#${oldState.channelId}>`, inline: true }
                        )
                        .setFooter({ text: `ID: ${member.id}` })
                        .setTimestamp();

                    await voiceLogChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }

            if (oldState.serverMute !== newState.serverMute) {
                const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id, true);

                const embed = new EmbedBuilder()
                    .setColor(newState.serverMute ? 0xED4245 : 0x57F287)
                    .setTitle(newState.serverMute ? 'ميوت سيرفر' : 'فك ميوت سيرفر')
                    .addFields(
                        { name: newState.serverMute ? 'اللي عطى الميوت' : 'اللي فك الميوت', value: executor ? `<@${executor.id}>` : 'غير معروف', inline: true },
                        { name: newState.serverMute ? 'انعطى لـ' : 'انفك من', value: `<@${member.id}>`, inline: true }
                    )
                    .setFooter({ text: `ID: ${member.id}` })
                    .setTimestamp();

                await voiceLogChannel.send({ embeds: [embed] }).catch(() => {});
            }

            if (oldState.serverDeaf !== newState.serverDeaf) {
                const executor = await getAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id, true);

                const embed = new EmbedBuilder()
                    .setColor(newState.serverDeaf ? 0xED4245 : 0x57F287)
                    .setTitle(newState.serverDeaf ? 'دفن سيرفر' : 'فك دفن سيرفر')
                    .addFields(
                        { name: newState.serverDeaf ? 'اللي عطى الدفن' : 'اللي فك الدفن', value: executor ? `<@${executor.id}>` : 'غير معروف', inline: true },
                        { name: newState.serverDeaf ? 'انعطى لـ' : 'انفك من', value: `<@${member.id}>`, inline: true }
                    )
                    .setFooter({ text: `ID: ${member.id}` })
                    .setTimestamp();

                await voiceLogChannel.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
    const config = VOICE_MOVE_CONFIGS[newState.channelId];

    if (!config) return;
    if (!newState.member) return;
    if (newState.member.user.bot) return;

    const guild = newState.guild;
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    const botMember = guild.members.me;

    if (!botMember) {
        await logChannel?.send('[VOICE ERR] ما قدرت ألقى عضوية البوت في السيرفر').catch(() => {});
        return;
    }

    let targetChannel = null;
    let debugInfo = '';

    for (const channelId of config.channels) {
        const adminChannel = await guild.channels.fetch(channelId).catch(() => null);

        if (!adminChannel || !adminChannel.isVoiceBased()) {
            debugInfo += `\nروم ${channelId}: مو موجود أو مو صوتي`;
            continue;
        }

        const members = [...adminChannel.members.values()].filter((member) => !member.user.bot);

        const admins = members.filter((member) => hasAnyRole(member, config.roles));
        const nonAdmins = members.filter((member) => !hasAnyRole(member, config.roles));

        const botPerms = adminChannel.permissionsFor(botMember);
        const canView = botPerms?.has('ViewChannel');
        const canConnect = botPerms?.has('Connect');
        const canMove = botMember.permissions.has('MoveMembers');

        debugInfo += `\nروم ${channelId}: إدارة=${admins.length} غير_إدارة=${nonAdmins.length} view=${canView} connect=${canConnect} move=${canMove}`;

        if (admins.length > 0 && nonAdmins.length === 0) {
            if (!canView || !canConnect || !canMove) {
                debugInfo += ` — مناسب لكن صلاحيات البوت ناقصة`;
                continue;
            }

            targetChannel = adminChannel;
            break;
        }
    }

    if (!targetChannel) {
        await logChannel?.send(`[VOICE] ما لقيت روم مناسب فيه إدارة بدون مواطن:${debugInfo}`).catch(() => {});
        return;
    }

    if (newState.channelId === targetChannel.id) return;

    await logChannel?.send(`[VOICE] بحاول أرفع <@${newState.member.id}> إلى <#${targetChannel.id}>`).catch(() => {});

    await newState.member.voice.setChannel(targetChannel.id, 'Auto-move to admin-only room').catch(async (err) => {
        await logChannel?.send(`[VOICE ERR] فشل الرفع إلى <#${targetChannel.id}>: ${err.message}`).catch(() => {});
    });
});
client.on('guildCreate', async (guild) => {
    await registerClearCommand(guild);
    await snapshotGuild(guild).catch(() => {});
});

if (!TOKEN) {
    console.log('[Bot] TOKEN is missing from environment variables');
    process.exit(1);
}

client.login(TOKEN);
