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

const VIDEO_REACTION_CHANNEL_ID = '1490108870524276876';
const VIDEO_REACTIONS = ['🔥', '🤣'];
const MEDIA_ONLY_TIMEOUT_MS = 5 * 60 * 1000;
const ROLE_LOG_CHANNEL_ID = '1493286656235540611';
const WAIT_ROOM_ID = '1493287394466861317';
const MEET_ROOM_ID = '1493287347788185742';
const TIMEOUT_LOG_CHANNEL_ID = '1494342102979444736';
const SERVER_LOG_CHANNEL_ID = '1494342769714663524';

const ADMIN_VOICE_CHANNELS = new Set([
    '1492450097462771833',
    '1492450059307192381',
    '1492450015703076884',
    '1492449967535816744',
    '1492449717186072606',
    '1492449616761852095',
    '1492449475912925214',
    '1492449422230032535',
    '1492449365611249715',
    '1492449319184502794',
]);

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
]);

function isAdminMember(member) {
    return member.roles.cache.some((role) => ADMIN_ROLE_IDS.has(role.id));
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
    '1490109001231372520',
    '1490109011176063097',
    '1490109004461113566',
    '1490109014032253179',
    '1490109019669663886',
    '1490109021506765060',
    '1493533721637158922',
    '1490108870524276876',
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

const roleSnapshots = new Map();
const channelSnapshots = new Map();
const memberRoleSnapshots = new Map();

const botActions = new Set();
const punishCooldowns = new Map();
const avatarCooldowns = new Map();

const restoringRoles = new Set();
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
        const channel = guild.channels.cache.get(SERVER_LOG_CHANNEL_ID);

        if (channel && channel.isTextBased()) {
           await channel.send(`[LOG] [${ts}] ${text}`).catch(() => {});
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
    restoringRoles.add(guild.id);

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

    restoringRoles.delete(guild.id);

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

    for (const memberId of memberIds) {
        const member = await guild.members.fetch(memberId).catch(() => null);

        if (!member) {
            console.log(`[RESTORE MEMBERS] could not fetch member ${memberId}`);
            continue;
        }

        markBotAction(memberKey(guild.id, member.id));

        await member.roles.add(role, 'Protection rollback: restore role membership').catch((err) => {
            console.log(`[RESTORE MEMBERS ERR] ${member.user.tag} — ${err.message}`);
        });

        const updated = await guild.members.fetch(member.id).catch(() => member);
        saveMember(updated);
    }

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
       await channel.send({
    content: text || undefined,
    files: attachments.map((attachment) => attachment.url),
});

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
    if (!message.guild) return;
       if (message.channel.id === VIDEO_REACTION_CHANNEL_ID) {
        const hasVideo = message.attachments.some((attachment) =>
            attachment.contentType?.startsWith('video/') ||
            /\.(mp4|mov|webm|mkv|avi)$/i.test(attachment.name ?? attachment.url)
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

        if (!hasVideo || hasRealText) {
            await message.delete().catch(() => {});

            const member = await message.guild.members.fetch(message.author.id).catch(() => null);

            if (member) {
                await member.timeout(MEDIA_ONLY_TIMEOUT_MS, 'روم مخصص للفيديو فقط').catch((err) => {
                    console.log(`[VIDEO ONLY TIMEOUT ERR] ${err.message}`);
                });
                       }

                      const timeoutReason = hasRealText
                ? 'ارسال كتابه في روم كليب'
                : message.attachments.some((a) =>
                    a.contentType?.startsWith('image/') ||
                    /\.(png|jpg|jpeg|gif|webp)$/i.test(a.name ?? a.url)
                  )
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

        for (const emoji of VIDEO_REACTIONS) {
            await message.react(emoji).catch((err) => {
                console.log(`[VIDEO REACT ERR] ${emoji} — ${err.message}`);
            });
        }

        return;
    }
    
    if (LINK_REGEX.test(message.content) && message.author.id !== OWNER_ID) {
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
    const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

    if (executor && isIgnored(executor.id, executor.bot)) {
        saveRole(newRole);
        return;
    }

    markBotAction(key);

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

    await sendLog(newChannel.guild, `رجعت تغيير روم: ${snapshot.name}`);
    await punish(newChannel.guild, executor, 'تعديل روم');
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
        const wasTimedOut = oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntil > new Date();
    const isNowTimedOut = newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date();

      console.log(`[TIMEOUT CHECK] ${newMember.id} — was:${!!wasTimedOut} now:${!!isNowTimedOut} until:${newMember.communicationDisabledUntil}`);

    if (!wasTimedOut && isNowTimedOut) {
        try {
            console.log(`[TIMEOUT TRIGGERED] ${newMember.id}`);
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
            const entry = [...auditLogs.entries.values()].find((e) =>
                e.target?.id === newMember.id && e.createdTimestamp >= Date.now() - 15000
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

                       const timeoutCh = newMember.guild.channels.cache.get(TIMEOUT_LOG_CHANNEL_ID) 
                ?? await newMember.guild.channels.fetch(TIMEOUT_LOG_CHANNEL_ID).catch(() => null);
            console.log(`[TIMEOUT CH] found:${!!timeoutCh} id:${TIMEOUT_LOG_CHANNEL_ID}`);
            if (timeoutCh && timeoutCh.isTextBased()) {
                await timeoutCh.send(
                    `@here\n\nperson : <@${newMember.id}>\n\nthe reason : ${auditReason}\n\nID : ${newMember.id}\n\nأعطاه التايم اوت : ${givenBy}\n\nالمدة : ${durationText}`
                ).catch(() => {});
            }
        } catch (err) {
            console.log(`[TIMEOUT DETECT ERR] ${err.message}`);
               }
    } else if (wasTimedOut && !isNowTimedOut) {
        try {
            const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
            const entry = [...auditLogs.entries.values()].find((e) =>
                e.target?.id === newMember.id && e.createdTimestamp >= Date.now() - 15000
            );
            const remover = entry?.executor ?? null;
            const removedBy = remover
                ? (remover.id === client.user?.id ? 'البوت' : `<@${remover.id}>`)
                : 'غير معروف';

            const timeoutCh = newMember.guild.channels.cache.get(TIMEOUT_LOG_CHANNEL_ID);
            if (timeoutCh && timeoutCh.isTextBased()) {
                await timeoutCh.send(
                    `person : <@${newMember.id}>\n\nتم فك التايم اوت بواسطة : ${removedBy}\n\nID : ${newMember.id}`
                ).catch(() => {});
            }
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

    saveMember(newMember);

    if (newMember.user.bot) return;

    const nonEveryoneRoles = newMember.roles.cache.filter((r) => r.id !== newMember.guild.id);

    if (nonEveryoneRoles.size === 0) {
        console.log(`[AUTO UNVERIFIED] ${newMember.user.tag} has no roles — assigning unverified`);
        await newMember.roles.add(UNVERIFIED_ROLE_ID, 'Auto-assign: member has no roles').catch((err) => {
            console.log(`[AUTO UNVERIFIED ERR] ${newMember.user.tag} — ${err.message}`);
        });
    }
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

client.on('guildMemberAdd', async (member) => {
    saveMember(member);
});
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (![WAIT_ROOM_ID, MEET_ROOM_ID].includes(newState.channelId)) return;
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

    for (const channelId of ADMIN_VOICE_CHANNELS) {
        const adminChannel = await guild.channels.fetch(channelId).catch(() => null);

        if (!adminChannel || !adminChannel.isVoiceBased()) {
            debugInfo += `\nروم ${channelId}: مو موجود أو مو صوتي`;
            continue;
        }

        const members = [...adminChannel.members.values()].filter((member) => !member.user.bot);

        const admins = members.filter((member) => isAdminMember(member));
        const citizens = members.filter((member) => !isAdminMember(member));

        const botPerms = adminChannel.permissionsFor(botMember);
        const canView = botPerms?.has('ViewChannel');
        const canConnect = botPerms?.has('Connect');
        const canMove = botMember.permissions.has('MoveMembers');

        debugInfo += `\nروم ${channelId}: إدارة=${admins.length} مواطن=${citizens.length} view=${canView} connect=${canConnect} move=${canMove}`;

        if (admins.length > 0 && citizens.length === 0) {
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

    await newState.member.voice.setChannel(targetChannel.id, 'Auto-move to admin room without citizens').catch(async (err) => {
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
