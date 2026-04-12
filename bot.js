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

console.log('NEW CODE VERSION SHORT CLEAN FULL PROTECTION VERIFY SEPARATOR CLEAR');

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

// Guild-level flags set BEFORE role/channel creation so roleCreate/channelCreate
// events that fire during creation are recognized as bot actions immediately
const restoringRoles = new Set();
const restoringChannels = new Set();

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

function isIgnored(userId, isBot = false) {
    // Trust the owner, the protection bot itself, and any other bots
    // (ticket bots, role bots, etc. create channels/roles legitimately)
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

async function getAuditExecutor(guild, type, targetId = null) {
    const minTime = Date.now() - 30000;

    for (let i = 0; i < AUDIT_RETRIES; i++) {
        await wait(AUDIT_WAIT_MS);

        try {
            const logs = await guild.fetchAuditLogs({
                type,
                limit: 10,
            });

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

            if (!entry) {
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

    // Re-fetch to get accurate post-removal state
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

async function restoreDeletedRole(guild, oldRoleId, snapshot) {
    // Mark guild as restoring BEFORE creation so the roleCreate event
    // that fires during guild.roles.create() is treated as a bot action
    restoringRoles.add(guild.id);

    const role = await guild.roles.create({
        name: snapshot.name,
        color: snapshot.color,
        hoist: snapshot.hoist,
        permissions: BigInt(snapshot.permissions),
        mentionable: snapshot.mentionable,
        reason: 'Protection rollback: restore deleted role',
    }).catch((error) => {
        console.log(`[RESTORE ROLE ERR] ${error.message}`);
        return null;
    });

    restoringRoles.delete(guild.id);

    if (!role) return null;

    markBotAction(roleKey(guild.id, role.id));

    await wait(1000);

    await role.setPosition(snapshot.rawPosition, { relative: false }).catch(() => {});

    roleSnapshots.delete(roleKey(guild.id, oldRoleId));
    roleSnapshots.set(roleKey(guild.id, role.id), {
        ...snapshot,
        id: role.id,
    });

    // Get member IDs from snapshot, or fall back to guild member cache
    const memberIds = snapshot.memberIds && snapshot.memberIds.length > 0
        ? snapshot.memberIds
        : [...guild.members.cache.values()]
            .filter((m) => m.roles.cache.has(oldRoleId))
            .map((m) => m.id);

    for (const memberId of memberIds) {
        const member = await guild.members.fetch(memberId).catch(() => null);

        if (!member) continue;

        markBotAction(memberKey(guild.id, member.id));

        await member.roles.add(role, 'Protection rollback: restore role membership').catch(() => {});

        const updated = await guild.members.fetch(member.id).catch(() => member);

        saveMember(updated);
    }

    return role;
}

async function restoreDeletedChannel(guild, snapshot) {
    // Mark guild as restoring BEFORE creation so the channelCreate event
    // that fires during guild.channels.create() is treated as a bot action
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
    if (!AVATAR_SEPARATOR_CHANNEL_IDS.has(message.channel.id)) return;
    if (!messageHasImage(message)) return;

    const cooldownKey = `${message.channel.id}:${message.author.id}`;
    const last = avatarCooldowns.get(cooldownKey);

    if (last && Date.now() - last < AVATAR_SEPARATOR_COOLDOWN_MS) {
        return;
    }

    avatarCooldowns.set(cooldownKey, Date.now());

    await wait(700);

    await message.channel.send({
        files: [AVATAR_SEPARATOR_FILE],
    }).catch(async (error) => {
        console.log(`[SEPARATOR ERR] ${error.message}`);
        await sendLog(message.guild, 'فشل إرسال separator.png. تأكد الصورة جنب bot.js وأن البوت عنده Attach Files.');
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

async function handleSendCommand(message) {
    if (!message.content.startsWith('!send ')) return false;

    const args = message.content.slice('!send '.length).trim();
    const firstSpace = args.indexOf(' ');

    if (firstSpace === -1) {
        await message.reply('اكتب كذا: `!send CHANNEL_ID الرسالة`').catch(() => {});
        return true;
    }

    const channelId = args.slice(0, firstSpace).replace('<#', '').replace('>', '').trim();
    const text = args.slice(firstSpace + 1).trim();

    if (!channelId || !text) {
        await message.reply('اكتب كذا: `!send CHANNEL_ID الرسالة`').catch(() => {});
        return true;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        await message.reply('ما لقيت الروم أو الروم مو كتابي.').catch(() => {});
        return true;
    }

    await channel.send(text);
    await message.reply('تم إرسال الرسالة.').catch(() => {});

    return true;
}

async function handleVerifyMessageCommand(message) {
    if (!message.content.startsWith('!verifymsg')) return false;

    let text = message.content.slice('!verifymsg'.length).trim();

    if (!text) {
        text = `*للتفعيل ودخول السيرفر اضغط على  ${VERIFY_EMOJI}  *\n\n@here`;
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

client.once('ready', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);

    for (const [, guild] of client.guilds.cache) {
        await registerClearCommand(guild);
        await snapshotGuild(guild).catch((error) => {
            console.log(`[SNAPSHOT ERR] ${error.message}`);
        });
    }

    console.log('[Bot] Protection active');
    console.log('[Bot] Verify active');
    console.log('[Bot] Avatar separator active');
    console.log('[Bot] Clear command active');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.author.id === OWNER_ID) {
        if (await handleSendCommand(message)) return;
        if (await handleVerifyMessageCommand(message)) return;
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

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        if (reaction.emoji.name !== VERIFY_EMOJI) return;
        if (!reaction.message.guild) return;
        if (reaction.message.channelId !== VERIFY_CHANNEL_ID) return;
        if (reaction.message.author?.id !== client.user?.id) return;

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

    // Check guild-level restore flag BEFORE isBotAction — new role ID isn't
    // known until after creation, so markBotAction can't be called in advance
    if (restoringRoles.has(role.guild.id) || isBotAction(key)) {
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

    // Capture member IDs RIGHT NOW before any async/await calls.
    // After the audit log wait (~6s), guildMemberUpdate events will have
    // already cleared this role from member caches — so we must read now.
    const memberIdsNow = [...role.members.keys()].length > 0
        ? [...role.members.keys()]
        : [...role.guild.members.cache.values()]
            .filter((m) => m.roles.cache.has(role.id))
            .map((m) => m.id);

    const snapshot = roleSnapshots.get(key) ?? {
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        rawPosition: role.rawPosition,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        memberIds: memberIdsNow,
    };

    // Always override with the freshest data captured at deletion time
    snapshot.memberIds = memberIdsNow;

    const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        roleSnapshots.delete(key);
        return;
    }

    const recreated = await restoreDeletedRole(role.guild, role.id, snapshot);

    if (recreated) {
        await sendLog(role.guild, `رجعت رتبة محذوفة: ${snapshot.name}`);
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

    // rawPosition excluded from changed check — moving a role shifts ALL other
    // roles and causes a cascade of roleUpdate events (spam + broken order)
    const changed =
        newRole.name !== snapshot.name ||
        newRole.color !== snapshot.color ||
        newRole.hoist !== snapshot.hoist ||
        newRole.mentionable !== snapshot.mentionable ||
        newRole.permissions.bitfield.toString() !== snapshot.permissions;

    if (!changed) return;

    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveRole(newRole);
        return;
    }

    markBotAction(key);

    if (newRole.name !== snapshot.name) {
        await newRole.setName(snapshot.name, 'Protection rollback role name').catch(() => {});
    }

    if (newRole.color !== snapshot.color) {
        await newRole.setColor(snapshot.color, 'Protection rollback role color').catch(() => {});
    }

    if (newRole.hoist !== snapshot.hoist) {
        await newRole.setHoist(snapshot.hoist, 'Protection rollback role hoist').catch(() => {});
    }

    if (newRole.mentionable !== snapshot.mentionable) {
        await newRole.setMentionable(snapshot.mentionable, 'Protection rollback role mentionable').catch(() => {});
    }

    if (newRole.permissions.bitfield.toString() !== snapshot.permissions) {
        await newRole.setPermissions(BigInt(snapshot.permissions), 'Protection rollback role permissions').catch(() => {});
    }

    // setPosition removed — restoring position causes ALL roles to shift
    // which triggers roleUpdate for every role in the server (spam + broken order)

    await sendLog(newRole.guild, `رجعت تغيير رتبة: ${snapshot.name}`);
    await punish(newRole.guild, executor, 'تعديل رتبه');
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;

    const key = channelKey(channel.guild.id, channel.id);

    // Check guild-level restore flag BEFORE isBotAction
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

    if (isBotAction(key)) {
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

    const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveChannel(newChannel);
        return;
    }

    markBotAction(key);

    if (newChannel.name !== snapshot.name) {
        await newChannel.setName(snapshot.name, 'Protection rollback channel name').catch(() => {});
    }

    if ((newChannel.parentId ?? null) !== snapshot.parentId && newChannel.type !== ChannelType.GuildCategory) {
        await newChannel.setParent(snapshot.parentId, {
            lockPermissions: false,
            reason: 'Protection rollback channel parent',
        }).catch(() => {});
    }

    if (currentOverwrites !== oldOverwrites) {
        await newChannel.permissionOverwrites.set(toOverwrites(snapshot), 'Protection rollback channel permissions').catch(() => {});
    }

    if ('setTopic' in newChannel && newChannel.topic !== snapshot.topic) {
        await newChannel.setTopic(snapshot.topic ?? null, 'Protection rollback channel topic').catch(() => {});
    }

    if ('setNSFW' in newChannel && newChannel.nsfw !== snapshot.nsfw) {
        await newChannel.setNSFW(snapshot.nsfw, 'Protection rollback channel nsfw').catch(() => {});
    }

    if ('setRateLimitPerUser' in newChannel && newChannel.rateLimitPerUser !== snapshot.rateLimitPerUser) {
        await newChannel.setRateLimitPerUser(snapshot.rateLimitPerUser ?? 0, 'Protection rollback channel slowmode').catch(() => {});
    }

    await sendLog(newChannel.guild, `رجعت تغيير روم: ${snapshot.name}`);
    await punish(newChannel.guild, executor, 'تعديل روم');
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    saveMember(newMember);

    if (newMember.user.bot) return;

    // Auto-assign unverified role to any member who ends up with no roles
    const nonEveryoneRoles = newMember.roles.cache.filter((r) => r.id !== newMember.guild.id);

    if (nonEveryoneRoles.size === 0) {
        console.log(`[AUTO UNVERIFIED] ${newMember.user.tag} has no roles — assigning unverified`);
        await newMember.roles.add(UNVERIFIED_ROLE_ID, 'Auto-assign: member has no roles').catch((err) => {
            console.log(`[AUTO UNVERIFIED ERR] ${newMember.user.tag} — ${err.message}`);
        });
    }
});

client.on('guildMemberAdd', async (member) => {
    saveMember(member);
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
