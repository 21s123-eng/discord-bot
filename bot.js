import {
    Client,
    GatewayIntentBits,
    AuditLogEvent,
    ChannelType,
    Partials,
    ApplicationCommandOptionType,
} from 'discord.js';

const TOKEN = process.env.TOKEN;

const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

const VERIFY_CHANNEL_ID = '1492435148439027722';
const VERIFY_EMOJI = '✅';
const VERIFY_ROLE_ID = '1490108840543260763';
const UNVERIFIED_ROLE_ID = '1491831215219806248';

const AVATAR_SEPARATOR_FILE = './separator.png';

const CLEAR_COMMAND_NAME = 'clear';
const MAX_CLEAR_AMOUNT = 1000;

const AVATAR_SEPARATOR_CHANNEL_IDS = new Set([
    '1492517673584558140',
    '1492517632186781767',
    '1492517584158068757',
    '1492517526012170300',
    '1492517479170179203',
    '1492517424325726300',
    '1492516778071556368',
]);

console.log('NEW CODE VERSION HERE VERIFY SHORT CLEAN FULL PROTECTION');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
    ],
});

const roleSnapshots = new Map();
const channelSnapshots = new Map();
const memberRoleSnapshots = new Map();

const botActions = new Set();
const punishCooldowns = new Map();
const avatarCooldowns = new Map();

const AUDIT_RETRIES = 6;
const AUDIT_WAIT_MS = 1000;
const PUNISH_COOLDOWN_MS = 5000;
const AVATAR_SEPARATOR_COOLDOWN_MS = 3000;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function isIgnored(userId) {
    return userId === OWNER_ID || userId === client.user?.id;
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

async function sendLog(guild, text) {
    console.log(`[LOG] ${text}`);

    try {
        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);

        if (channel && channel.isTextBased()) {
            await channel.send(`[LOG] ${text}`).catch(() => {});
        }
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

async function get
