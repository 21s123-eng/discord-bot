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
        ...snapshot,
        id: recreated.id,
    });

    return recreated;
}

async function snapshotGuild(guild) {
    console.log(`[SNAPSHOT] loading guild: ${guild.name}`);

    try {
        await guild.members.fetch();
        console.log(`[SNAPSHOT] members fetched: ${guild.members.cache.size}`);
    } catch (e) {
        console.log(`[SNAPSHOT] members fetch failed: ${e.message}`);
        console.log('[SNAPSHOT] enable Server Members Intent in Discord Developer Portal');
    }

    const roles = await guild.roles.fetch();

    for (const [, role] of roles) {
        saveRoleSnapshot(role);
    }

    for (const [, member] of guild.members.cache) {
        saveMemberRoleSnapshot(member);
    }

    const channels = await guild.channels.fetch();

    for (const [, channel] of channels) {
        if (channel) {
            saveChannelSnapshot(channel);
        }
    }

    console.log(`[SNAPSHOT] ${guild.name}: roles=${roles.size} members=${guild.members.cache.size} channels=${channels.size}`);
}

async function registerClearCommand(guild) {
    await guild.commands.create({
        name: CLEAR_COMMAND_NAME,
        description: 'حذف عدد معين من الرسائل في الروم',
        options: [
            {
                name: 'amount',
                description: 'عدد الرسائل المطلوب حذفها من 1 إلى 1000',
                type: 4,
                required: true,
                minValue: 1,
                maxValue: MAX_CLEAR_AMOUNT,
            },
        ],
    }).catch((e) => {
        console.log(`[CLEAR COMMAND REGISTER ERR] ${guild.name}: ${e.message}`);
    });
}

async function handleOwnerSendCommand(message) {
    if (!message.content.startsWith('!send ')) return false;

    const args = message.content.slice('!send '.length).trim();
    const firstSpace = args.indexOf(' ');

    if (firstSpace === -1) {
        await message.reply('اكتب كذا: `!send CHANNEL_ID الرسالة`').catch(() => {});
        return true;
    }

    let channelId = args.slice(0, firstSpace).trim();
    const text = args.slice(firstSpace + 1).trim();

    channelId = channelId.replace('<#', '').replace('>', '');

    if (!channelId || !text) {
        await message.reply('اكتب كذا: `!send CHANNEL_ID الرسالة`').catch(() => {});
        return true;
    }

    try {
        const channel = await client.channels.fetch(channelId);

        if (!channel || !channel.isTextBased()) {
            await message.reply('ما لقيت الروم أو الروم مو كتابي.').catch(() => {});
            return true;
        }

        await channel.send(text);
        await message.reply('تم إرسال الرسالة.').catch(() => {});
    } catch (e) {
        console.log(`[OWNER SEND ERR] ${e.message}`);
        await message.reply(`صار خطأ: ${e.message}`).catch(() => {});
    }

    return true;
}

async function handleVerifyMessageCommand(message) {
    if (!message.content.startsWith('!verifymsg')) return false;

    let text = message.content.slice('!verifymsg'.length).trim();

    if (!text) {
        text = `اضغط ${VERIFY_EMOJI} عشان تتفعل وتدخل السيرفر`;
    }

    try {
        const channel = await client.channels.fetch(VERIFY_CHANNEL_ID);

        if (!channel || !channel.isTextBased()) {
            await message.reply('ما لقيت روم التفعيل أو الروم مو كتابي.').catch(() => {});
            return true;
        }

        const sent = await channel.send(text);

        await sent.react(VERIFY_EMOJI);

        await message.reply(
            `تم إرسال رسالة التفعيل في <#${VERIFY_CHANNEL_ID}>.\nMessage ID: \`${sent.id}\`\nالإيموجي: ${VERIFY_EMOJI}`
        ).catch(() => {});
    } catch (e) {
        console.log(`[VERIFY MSG ERR] ${e.message}`);
        await message.reply(`صار خطأ: ${e.message}`).catch(() => {});
    }

    return true;
}

client.once('ready', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);

    for (const [, guild] of client.guilds.cache) {
        await registerClearCommand(guild);

        try {
            await snapshotGuild(guild);
        } catch (e) {
            console.log(`[Bot] snapshot failed for ${guild.name}: ${e.message}`);
        }
    }

    console.log(`[Bot] Role snapshots: ${roleSnapshots.size}`);
    console.log(`[Bot] Channel snapshots: ${channelSnapshots.size}`);
    console.log(`[Bot] Member role snapshots: ${memberRoleSnapshots.size}`);
    console.log('[Bot] Protection active');
    console.log('[Bot] Clear command active');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.author.id === OWNER_ID) {
        const handledSend = await handleOwnerSendCommand(message);
        if (handledSend) return;

        const handledVerify = await handleVerifyMessageCommand(message);
        if (handledVerify) return;
    }

    await handleAvatarSeparator(message);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== CLEAR_COMMAND_NAME) return;

    if (interaction.user.id !== OWNER_ID) {
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

    let deletedTotal = 0;
    let remaining = amount;

    try {
        while (remaining > 0) {
            const limit = Math.min(remaining, 100);

            const messages = await interaction.channel.messages.fetch({
                limit,
            });

            if (messages.size === 0) break;

            const deleted = await interaction.channel.bulkDelete(messages, true);

            deletedTotal += deleted.size;
            remaining -= messages.size;

            if (deleted.size === 0) break;

            await wait(1000);
        }

        await interaction.followUp({
            content: `تم حذف ${deletedTotal} رسالة.`,
            ephemeral: true,
        }).catch(() => {});
    } catch (e) {
        console.log(`[CLEAR ERR] ${e.message}`);

        await interaction.followUp({
            content: `صار خطأ أثناء الحذف: ${e.message}`,
            ephemeral: true,
        }).catch(() => {});
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    try {
        if (reaction.partial) {
            await reaction.fetch();
        }

        if (reaction.message.partial) {
            await reaction.message.fetch();
        }

        if (reaction.emoji.name !== VERIFY_EMOJI) return;
        if (!reaction.message.guild) return;
        if (reaction.message.channelId !== VERIFY_CHANNEL_ID) return;

        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);

        const verifyRole = guild.roles.cache.get(VERIFY_ROLE_ID);
        const unverifiedRole = guild.roles.cache.get(UNVERIFIED_ROLE_ID);

        if (!verifyRole) {
            console.log(`[VERIFY] verify role not found: ${VERIFY_ROLE_ID}`);
            await log(guild, `رتبة التفعيل غير موجودة: ${VERIFY_ROLE_ID}`);
            return;
        }

        const key = memberKey(guild.id, member.id);

        botChangingMembers.add(key);

        setTimeout(() => {
            botChangingMembers.delete(key);
        }, 15000);

        if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.remove(unverifiedRole, 'Verification: remove unverified role').catch((e) => {
                console.log(`[VERIFY remove old role ERR] ${e.message}`);
            });
        }

        if (!member.roles.cache.has(verifyRole.id)) {
            await member.roles.add(verifyRole, 'Verification: add verified role').catch((e) => {
                console.log(`[VERIFY add role ERR] ${e.message}`);
            });
        }

        const updatedMember = await guild.members.fetch(user.id).catch(() => member);

        saveMemberRoleSnapshot(updatedMember);
        saveRoleSnapshot(verifyRole);

        if (unverifiedRole) {
            saveRoleSnapshot(unverifiedRole);
        }

        await log(guild, `تم تفعيل العضو <@${member.id}>`);
    } catch (e) {
        console.log(`[VERIFY ADD ERR] ${e.message}`);
    }
});

client.on('roleCreate', async (role) => {
    if (role.managed) return;

    const key = roleKey(role.guild.id, role.id);
    const nameKey = roleNameKey(role.guild.id, role.name);

    if (botCreatingRoleNames.has(nameKey)) {
        console.log(`[roleCreate] bot recreated role ignored: ${role.name}`);
        saveRoleSnapshot(role);
        return;
    }

    console.log(`[roleCreate] unauthorized role created: ${role.name}`);

    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);

    if (executor && isIgnored(executor.id)) {
        console.log('[roleCreate] owner/bot change accepted');
        saveRoleSnapshot(role);
        return;
    }

    try {
        botDeletingRoles.add(key);

        setTimeout(() => {
            botDeletingRoles.delete(key);
        }, 10000);

        await role.delete('Protection rollback: unauthorized role create').catch((e) => {
            console.log(`[roleCreate delete ERR] ${e.message}`);
        });

        deleteRoleSnapshot(role.guild.id, role.id);
        removeRoleIdFromMemberSnapshots(role.guild.id, role.id);

        await log(role.guild, `حذفت رتبة جديدة غير مصرح بها: ${role.name}`);
        await punish(role.guild, executor, 'اضافة رتبه جديده');
    } catch (e) {
        console.log(`[roleCreate ERR] ${e.message}`);
    }
});

client.on('roleDelete', async (role) => {
    const key = roleKey(role.guild.id, role.id);

    if (botDeletingRoles.has(key)) {
        console.log(`[roleDelete] bot delete ignored: ${role.name}`);
        botDeletingRoles.delete(key);
        deleteRoleSnapshot(role.guild.id, role.id);
        return;
    }

    const snapshot = roleSnapshots.get(key) ?? getRoleSnapshot(role);

    console.log(`[roleDelete] role deleted: ${role.name}`);

    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

    if (executor && isIgnored(executor.id)) {
        console.log('[roleDelete] owner/bot delete accepted');
        deleteRoleSnapshot(role.guild.id, role.id);
        removeRoleIdFromMemberSnapshots(role.guild.id, role.id);
        return;
    }

    try {
        const nameKey = roleNameKey(role.guild.id, snapshot.name);

        botCreatingRoleNames.add(nameKey);

        setTimeout(() => {
            botCreatingRoleNames.delete(nameKey);
        }, 15000);

        deleteRoleSnapshot(role.guild.id, role.id);

        const recreated = await restoreDeletedRole(role.guild, role.id, snapshot);

        if (recreated) {
            await log(role.guild, `رجعت رتبة محذوفة: ${snapshot.name} وحاولت أرجعها للأعضاء`);
        } else {
            await log(role.guild, `فشلت أرجع الرتبة المحذوفة: ${snapshot.name}`);
        }

        await punish(role.guild, executor, 'حذف رتبه');
    } catch (e) {
        console.log(`[roleDelete ERR] ${e.message}`);
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (newRole.managed) return;

    const key = roleKey(newRole.guild.id, newRole.id);

    if (botRestoringRoles.has(key)) {
        console.log(`[roleUpdate] bot restore ignored: ${newRole.name}`);
        botRestoringRoles.delete(key);
        return;
    }

    const snapshot = roleSnapshots.get(key);

    if (!snapshot) {
        console.log(`[roleUpdate] missing snapshot, saving role: ${newRole.name}`);
        saveRoleSnapshot(newRole);
        return;
    }

    const nameChanged = newRole.name !== snapshot.name;
    const colorChanged = newRole.color !== snapshot.color;
    const permissionsChanged = newRole.permissions.bitfield.toString() !== snapshot.permissions;
    const mentionableChanged = newRole.mentionable !== snapshot.mentionable;
    const hoistChanged = newRole.hoist !== snapshot.hoist;
    const positionChanged = newRole.rawPosition !== snapshot.rawPosition;

    if (
        !nameChanged &&
        !colorChanged &&
        !permissionsChanged &&
        !mentionableChanged &&
        !hoistChanged &&
        !positionChanged
    ) {
        return;
    }

    console.log(
        `[roleUpdate] rollback ${newRole.name} name:${nameChanged} color:${colorChanged} perms:${permissionsChanged} mention:${mentionableChanged} hoist:${hoistChanged} pos:${positionChanged}`
    );

    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

    if (executor && isIgnored(executor.id)) {
        console.log('[roleUpdate] owner/bot update accepted');
        saveRoleSnapshot(newRole);
        return;
    }

    try {
        botRestoringRoles.add(key);

        setTimeout(() => {
            botRestoringRoles.delete(key);
        }, 10000);

        if (nameChanged) {
            await newRole.setName(snapshot.name, 'Protection rollback: role name').catch((e) => {
                console.log(`[roleUpdate setName ERR] ${e.message}`);
            });
        }

        if (colorChanged) {
            await newRole.setColor(snapshot.color, 'Protection rollback: role color').catch((e) => {
                console.log(`[roleUpdate setColor ERR] ${e.message}`);
            });
        }

        if (permissionsChanged) {
            await newRole.setPermissions(BigInt(snapshot.permissions), 'Protection rollback: role permissions').catch((e) => {
                console.log(`[roleUpdate setPermissions ERR] ${e.message}`);
            });
        }

        if (mentionableChanged) {
            await newRole.setMentionable(snapshot.mentionable, 'Protection rollback: role mentionable').catch((e) => {
                console.log(`[roleUpdate setMentionable ERR] ${e.message}`);
            });
        }

        if (hoistChanged) {
            await newRole.setHoist(snapshot.hoist, 'Protection rollback: role hoist').catch((e) => {
                console.log(`[roleUpdate setHoist ERR] ${e.message}`);
            });
        }

        if (positionChanged) {
            await newRole.setPosition(snapshot.rawPosition, { relative: false }).catch((e) => {
                console.log(`[roleUpdate setPosition ERR] ${e.message}`);
            });
        }

        let reason = 'تعديل رتبه';

        if (positionChanged) reason = 'تغيير مكان رتبه';
        else if (nameChanged) reason = 'تغيير اسم رتبه';
        else if (colorChanged) reason = 'تغيير لون رتبه';
        else if (permissionsChanged) reason = 'تغيير صلاحيات رتبه';
        else if (mentionableChanged) reason = 'تغيير منشن رتبه';
        else if (hoistChanged) reason = 'تغيير ظهور رتبه';

        await log(newRole.guild, `رجعت تغيير رتبة: ${snapshot.name}`);
        await punish(newRole.guild, executor, reason);
    } catch (e) {
        console.log(`[roleUpdate ERR] ${e.message}`);
    }
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;

    const key = channelKey(channel.guild.id, channel.id);
    const nameKey = channelNameKey(channel.guild.id, channel.name, channel.type);

    if (botCreatingChannelNames.has(nameKey)) {
        console.log(`[channelCreate] bot recreated channel ignored: ${channel.name}`);
        saveChannelSnapshot(channel);
        return;
    }

    console.log(`[channelCreate] unauthorized channel created: ${channel.name}`);

    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

    if (executor && isIgnored(executor.id)) {
        console.log('[channelCreate] owner/bot create accepted');
        saveChannelSnapshot(channel);
        return;
    }

    try {
        botDeletingChannels.add(key);

        setTimeout(() => {
            botDeletingChannels.delete(key);
        }, 10000);

        await channel.delete('Protection rollback: unauthorized channel create').catch((e) => {
            console.log(`[channelCreate delete ERR] ${e.message}`);
        });

        deleteChannelSnapshot(channel.guild.id, channel.id);

        await log(channel.guild, `حذفت روم جديد غير مصرح به: ${channel.name}`);
        await punish(channel.guild, executor, 'اضافة روم');
    } catch (e) {
        console.log(`[channelCreate ERR] ${e.message}`);
    }
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;

    const key = channelKey(channel.guild.id, channel.id);

    if (botDeletingChannels.has(key)) {
        console.log(`[channelDelete] bot delete ignored: ${channel.name}`);
        botDeletingChannels.delete(key);
        deleteChannelSnapshot(channel.guild.id, channel.id);
        return;
    }

    const snapshot = channelSnapshots.get(key) ?? getChannelSnapshot(channel);

    console.log(`[channelDelete] channel deleted: ${channel.name}`);

    const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

    if (executor && isIgnored(executor.id)) {
        console.log('[channelDelete] owner/bot delete accepted');
        deleteChannelSnapshot(channel.guild.id, channel.id);
        return;
    }

    try {
        const nameKey = channelNameKey(channel.guild.id, snapshot.name, snapshot.type);

        botCreatingChannelNames.add(nameKey);

        setTimeout(() => {
            botCreatingChannelNames.delete(nameKey);
        }, 15000);

        deleteChannelSnapshot(channel.guild.id, channel.id);

        const recreated = await restoreDeletedChannel(channel.guild, snapshot);

        if (recreated) {
            await log(channel.guild, `رجعت روم محذوف: ${snapshot.name} — ملاحظة: الرسائل القديمة لا يمكن إرجاعها من Discord`);
        } else {
            await log(channel.guild, `فشلت أرجع الروم المحذوف: ${snapshot.name}`);
        }

        const reason = snapshot.type === ChannelType.GuildCategory ? 'حذف كاتوقري' : 'حذف روم';
        await punish(channel.guild, executor, reason);
    } catch (e) {
        console.log(`[channelDelete ERR] ${e.message}`);
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    const key = channelKey(newChannel.guild.id, newChannel.id);

    if (botRestoringChannels.has(key)) {
        console.log(`[channelUpdate] bot restore ignored: ${newChannel.name}`);
        botRestoringChannels.delete(key);
        return;
    }

    const snapshot = channelSnapshots.get(key);

    if (!snapshot) {
        console.log(`[channelUpdate] missing snapshot, saving channel: ${newChannel.name}`);
        saveChannelSnapshot(newChannel);
        return;
    }

    const currentOverwrites = getChannelOverwrites(newChannel);

    const nameChanged = newChannel.name !== snapshot.name;
    const positionChanged = (newChannel.rawPosition ?? 0) !== snapshot.rawPosition;
    const parentChanged = (newChannel.parentId ?? null) !== snapshot.parentId;
    const permChanged = JSON.stringify(currentOverwrites) !== JSON.stringify(snapshot.permissionOverwrites);

    const topicChanged = 'topic' in newChannel && newChannel.topic !== snapshot.topic;
    const nsfwChanged = 'nsfw' in newChannel && newChannel.nsfw !== snapshot.nsfw;
    const slowmodeChanged = 'rateLimitPerUser' in newChannel && newChannel.rateLimitPerUser !== snapshot.rateLimitPerUser;

    if (
        !nameChanged &&
        !positionChanged &&
        !parentChanged &&
        !permChanged &&
        !topicChanged &&
        !nsfwChanged &&
        !slowmodeChanged
    ) {
        return;
    }

    console.log(
        `[channelUpdate] rollback ${newChannel.name} name:${nameChanged} pos:${positionChanged} parent:${parentChanged} perms:${permChanged}`
    );

    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);

    if (executor && isIgnored(executor.id)) {
        console.log('[channelUpdate] owner/bot update accepted');
        saveChannelSnapshot(newChannel);
        return;
    }

    try {
        botRestoringChannels.add(key);

        setTimeout(() => {
            botRestoringChannels.delete(key);
        }, 10000);

        if (nameChanged) {
            await newChannel.setName(snapshot.name, 'Protection rollback: channel name').catch((e) => {
                console.log(`[channelUpdate setName ERR] ${e.message}`);
            });
        }

        if (parentChanged && newChannel.type !== ChannelType.GuildCategory) {
            await newChannel.setParent(snapshot.parentId, {
                lockPermissions: false,
                reason: 'Protection rollback: channel parent',
            }).catch((e) => {
                console.log(`[channelUpdate setParent ERR] ${e.message}`);
            });
        }

        if (permChanged) {
            await newChannel.permissionOverwrites.set(
                toOverwrites(snapshot),
                'Protection rollback: channel permissions'
            ).catch((e) => {
                console.log(`[channelUpdate perms ERR] ${e.message}`);
            }); **...**

_This response is too long to display in full._
