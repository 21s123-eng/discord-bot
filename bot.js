import {
    Client,
    GatewayIntentBits,
    AuditLogEvent,
    ChannelType,
    Partials,
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

console.log('NEW CODE VERSION FULL PROTECTION VERIFY AVATAR SEPARATOR CLEAR COMMAND');

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

const botDeletingRoles = new Set();
const botRestoringRoles = new Set();
const botCreatingRoleNames = new Set();

const botDeletingChannels = new Set();
const botRestoringChannels = new Set();
const botCreatingChannelNames = new Set();

const botChangingMembers = new Set();
const recentPunishments = new Map();

const avatarSeparatorCooldown = new Map();

const AUDIT_RETRIES = 6;
const AUDIT_WAIT_MS = 1000;
const PUNISH_COOLDOWN_MS = 5000;
const AVATAR_SEPARATOR_COOLDOWN_MS = 3000;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function roleKey(guildId, roleId) {
    return `${guildId}:${roleId}`;
}

function roleNameKey(guildId, name) {
    return `${guildId}:${name}`;
}

function channelKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
}

function channelNameKey(guildId, name, type) {
    return `${guildId}:${name}:${type}`;
}

function memberKey(guildId, memberId) {
    return `${guildId}:${memberId}`;
}

function isIgnored(userId) {
    return userId === OWNER_ID || userId === client.user?.id;
}

function isCooldown(guildId, userId, reason) {
    const key = `${guildId}:${userId}:${reason}`;
    const last = recentPunishments.get(key);

    if (last && Date.now() - last < PUNISH_COOLDOWN_MS) {
        return true;
    }

    recentPunishments.set(key, Date.now());
    return false;
}

async function log(guild, msg) {
    console.log(`[LOG] ${msg}`);

    try {
        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);

        if (!channel) {
            console.log(`[LOG] channel not found: ${LOG_CHANNEL_ID}`);
            return;
        }

        await channel.send(`[LOG] ${msg}`).catch((e) => {
            console.log(`[LOG SEND ERR] ${e.message}`);
        });
    } catch (e) {
        console.log(`[LOG ERR] ${e.message}`);
    }
}

function getRoleSnapshot(role) {
    return {
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        rawPosition: role.rawPosition,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        managed: role.managed,
        memberIds: [...role.members.keys()],
    };
}

function saveRoleSnapshot(role) {
    roleSnapshots.set(roleKey(role.guild.id, role.id), getRoleSnapshot(role));
}

function deleteRoleSnapshot(guildId, roleId) {
    roleSnapshots.delete(roleKey(guildId, roleId));
}

function getChannelOverwrites(channel) {
    return channel.permissionOverwrites?.cache?.map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
    })) ?? [];
}

function getChannelSnapshot(channel) {
    return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        rawPosition: channel.rawPosition ?? 0,
        parentId: channel.parentId ?? null,
        permissionOverwrites: getChannelOverwrites(channel),

        topic: 'topic' in channel ? channel.topic : null,
        nsfw: 'nsfw' in channel ? channel.nsfw : false,
        rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0,

        bitrate: 'bitrate' in channel ? channel.bitrate : null,
        userLimit: 'userLimit' in channel ? channel.userLimit : null,
    };
}

function saveChannelSnapshot(channel) {
    if (!channel.guild) return;
    channelSnapshots.set(channelKey(channel.guild.id, channel.id), getChannelSnapshot(channel));
}

function deleteChannelSnapshot(guildId, channelId) {
    channelSnapshots.delete(channelKey(guildId, channelId));
}

function saveMemberRoleSnapshot(member) {
    memberRoleSnapshots.set(
        memberKey(member.guild.id, member.id),
        new Set(member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => role.id))
    );
}

function replaceRoleIdInMemberSnapshots(guildId, oldRoleId, newRoleId, memberIds) {
    for (const memberId of memberIds) {
        const key = memberKey(guildId, memberId);
        const roles = memberRoleSnapshots.get(key) ?? new Set();

        roles.delete(oldRoleId);
        roles.add(newRoleId);

        memberRoleSnapshots.set(key, roles);
    }
}

function removeRoleIdFromMemberSnapshots(guildId, roleId) {
    for (const [key, roles] of memberRoleSnapshots) {
        if (!key.startsWith(`${guildId}:`)) continue;
        roles.delete(roleId);
    }
}

function toOverwrites(snapshot) {
    return snapshot.permissionOverwrites.map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: BigInt(overwrite.allow),
        deny: BigInt(overwrite.deny),
    }));
}

function messageHasImage(message) {
    const hasImageAttachment = message.attachments.some((attachment) => {
        if (attachment.contentType?.startsWith('image/')) return true;
        return /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.name ?? attachment.url ?? '');
    });

    if (hasImageAttachment) return true;

    return /(https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?)/i.test(message.content);
}

async function handleAvatarSeparator(message) {
    if (!AVATAR_SEPARATOR_CHANNEL_IDS.has(message.channel.id)) return;
    if (!messageHasImage(message)) return;

    const cooldownKey = `${message.channel.id}:${message.author.id}`;
    const last = avatarSeparatorCooldown.get(cooldownKey);

    if (last && Date.now() - last < AVATAR_SEPARATOR_COOLDOWN_MS) {
        return;
    }

    avatarSeparatorCooldown.set(cooldownKey, Date.now());

    try {
        await wait(700);

        await message.channel.send({
            files: [AVATAR_SEPARATOR_FILE],
        });
    } catch (e) {
        console.log(`[AVATAR SEPARATOR ERR] ${e.message}`);
        await log(message.guild, 'فشل إرسال صورة فاصل الافتارات. تأكد أن الملف موجود باسم separator.png جنب bot.js');
    }
}

async function getAuditExecutor(guild, type, targetId = null) {
    const minTime = Date.now() - 30000;

    for (let attempt = 1; attempt <= AUDIT_RETRIES; attempt++) {
        await wait(AUDIT_WAIT_MS);

        try {
            const logs = await guild.fetchAuditLogs({
                type,
                limit: 10,
            });

            const entries = [...logs.entries.values()];

            console.log(`[AUDIT] type:${type} attempt:${attempt} entries:${entries.length}`);

            let entry = null;

            if (targetId) {
                entry = entries.find(
                    (e) =>
                        e.target?.id === targetId &&
                        e.executor?.id &&
                        e.executor.id !== client.user?.id &&
                        e.createdTimestamp >= minTime
                );
            }

            if (!entry) {
                entry = entries.find(
                    (e) =>
                        e.executor?.id &&
                        e.executor.id !== client.user?.id &&
                        e.createdTimestamp >= minTime
                );
            }

            if (entry?.executor) {
                console.log(`[AUDIT] found executor: ${entry.executor.id}`);
                return entry.executor;
            }
        } catch (e) {
            console.log(`[AUDIT ERR] ${e.message}`);
        }
    }

    console.log('[AUDIT] no executor found');
    return null;
}

async function removeAllRoles(member) {
    const botMember = member.guild.members.me;

    if (!botMember) {
        console.log('[PUNISH] bot member not found');
        return 'bot_member_not_found';
    }

    const botHighestPosition = botMember.roles.highest.position;

    const removable = member.roles.cache.filter(
        (role) =>
            role.id !== member.guild.id &&
            !role.managed &&
            role.position < botHighestPosition
    );

    if (removable.size === 0) {
        return 'no_removable_roles';
    }

    const key = memberKey(member.guild.id, member.id);

    botChangingMembers.add(key);

    setTimeout(() => {
        botChangingMembers.delete(key);
    }, 10000);

    await member.roles.remove([...removable.keys()], 'Protection punishment');

    const updatedMember = await member.guild.members.fetch(member.id).catch(() => member);
    saveMemberRoleSnapshot(updatedMember);

    return `removed_${removable.size}`;
}

async function sendPunishLog(guild, user, reason) {
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);

    if (!channel) {
        console.log('[SENDLOG] channel not found');
        return;
    }

    await channel.send(
        `@here\n\nperson : <@${user.id}>\n\nthe reason : ${reason}\n\nID : ${user.id}`
    ).catch((e) => {
        console.log(`[SENDLOG ERR] ${e.message}`);
    });
}

async function punish(guild, executor, reason) {
    if (!executor) {
        await log(guild, `رجعت التغيير، لكن ما قدرت أعرف الشخص من Audit Log — السبب: ${reason}`);
        return;
    }

    if (isIgnored(executor.id)) {
        console.log(`[PUNISH] ignored executor: ${executor.id}`);
        return;
    }

    if (isCooldown(guild.id, executor.id, reason)) {
        console.log(`[PUNISH] cooldown executor:${executor.id} reason:${reason}`);
        return;
    }

    try {
        const member = await guild.members.fetch(executor.id);

        const result = await removeAllRoles(member);

        await log(guild, `عاقبت <@${executor.id}> — ${reason} — ${result}`);
        await sendPunishLog(guild, executor, reason);
    } catch (e) {
        console.log(`[PUNISH ERR] ${e.message}`);
        await log(guild, `فشل العقاب: ${e.message}`);
    }
}

async function restoreDeletedRole(guild, oldRoleId, snapshot) {
    const recreated = await guild.roles.create({
        name: snapshot.name,
        color: snapshot.color,
        hoist: snapshot.hoist,
        permissions: BigInt(snapshot.permissions),
        mentionable: snapshot.mentionable,
        reason: 'Protection rollback: restore deleted role',
    }).catch((e) => {
        console.log(`[restoreDeletedRole create ERR] ${e.message}`);
        return null;
    });

    if (!recreated) return null;

    const recreatedKey = roleKey(guild.id, recreated.id);

    botRestoringRoles.add(recreatedKey);

    setTimeout(() => {
        botRestoringRoles.delete(recreatedKey);
    }, 10000);

    await wait(1000);

    await recreated.setPosition(snapshot.rawPosition, { relative: false }).catch((e) => {
        console.log(`[restoreDeletedRole setPosition ERR] ${e.message}`);
    });

    const newSnapshot = {
        ...snapshot,
        id: recreated.id,
    };

    roleSnapshots.set(recreatedKey, newSnapshot);
    replaceRoleIdInMemberSnapshots(guild.id, oldRoleId, recreated.id, snapshot.memberIds);

    for (const memberId of snapshot.memberIds) {
        try {
            const member = await guild.members.fetch(memberId);

            const key = memberKey(guild.id, member.id);

            botChangingMembers.add(key);

            setTimeout(() => {
                botChangingMembers.delete(key);
            }, 10000);

            await member.roles.add(recreated, 'Protection rollback: restore deleted role membership').catch((e) => {
                console.log(`[restoreDeletedRole member add ERR] ${memberId}: ${e.message}`);
            });

            const updatedMember = await guild.members.fetch(memberId).catch(() => member);
            saveMemberRoleSnapshot(updatedMember);
        } catch (e) {
            console.log(`[restoreDeletedRole fetch member ERR] ${memberId}: ${e.message}`);
        }
    }

    return recreated;
}

async function restoreDeletedChannel(guild, snapshot) {
    const isCategory = snapshot.type === ChannelType.GuildCategory;

    const createOptions = {
        name: snapshot.name,
        type: snapshot.type,
        permissionOverwrites: toOverwrites(snapshot),
        reason: 'Protection rollback: restore deleted channel',
    };

    if (!isCategory && snapshot.parentId) {
        createOptions.parent = snapshot.parentId;
    }

    if (
        snapshot.type === ChannelType.GuildText ||
        snapshot.type === ChannelType.GuildAnnouncement ||
        snapshot.type === ChannelType.GuildForum
    ) {
        if (snapshot.topic !== null && snapshot.topic !== undefined) {
            createOptions.topic = snapshot.topic;
        }

        createOptions.nsfw = snapshot.nsfw;
        createOptions.rateLimitPerUser = snapshot.rateLimitPerUser ?? 0;
    }

    if (
        snapshot.type === ChannelType.GuildVoice ||
        snapshot.type === ChannelType.GuildStageVoice
    ) {
        if (snapshot.bitrate) createOptions.bitrate = snapshot.bitrate;

        if (snapshot.userLimit !== null && snapshot.userLimit !== undefined) {
            createOptions.userLimit = snapshot.userLimit;
        }
    }

    const recreated = await guild.channels.create(createOptions).catch((e) => {
        console.log(`[restoreDeletedChannel create ERR] ${e.message}`);
        return null;
    });

    if (!recreated) return null;

    const recreatedKey = channelKey(guild.id, recreated.id);

    botRestoringChannels.add(recreatedKey);

    setTimeout(() => {
        botRestoringChannels.delete(recreatedKey);
    }, 10000);

    await wait(1000);

    await recreated.setPosition(snapshot.rawPosition).catch((e) => {
        console.log(`[restoreDeletedChannel setPosition ERR] ${e.message}`);
    });

    channelSnapshots.set(recreatedKey, {
