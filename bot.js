import {
    Client,
    GatewayIntentBits,
    AuditLogEvent,
    ChannelType,
} from 'discord.js';

const TOKEN = process.env.TOKEN;
const OWNER_ID = '1125609597613375629';
const LOG_CHANNEL_ID = '1492108809618063432';

console.log('NEW CODE VERSION FIXED COMPLETE BOT');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
    ],
});

const recentPunishments = new Map();
const storedRolePositions = new Map();
const storedChannelPositions = new Map();

const guildRoleAuditPromises = new Map();
const guildChannelAuditPromises = new Map();

const botRestoringRoles = new Set();
const botRestoringChannels = new Set();

const COOLDOWN_MS = 5000;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIgnored(userId) {
    return userId === OWNER_ID || userId === client.user?.id;
}

function isPunishmentOnCooldown(guildId, executorId, reason) {
    const key = `${guildId}:${executorId}:${reason}`;
    const last = recentPunishments.get(key);

    if (last && Date.now() - last < COOLDOWN_MS) return true;

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

function printAuditDebug(entries) {
    for (const entry of entries.slice(0, 8)) {
        console.log(
            `[AUDIT DEBUG] action:${entry.action} target:${entry.target?.id ?? 'none'} executor:${entry.executor?.id ?? 'none'} age:${Date.now() - entry.createdTimestamp}ms`
        );
    }
}

async function fetchAuditEntries(guild, auditLogEvent) {
    try {
        const logs = await guild.fetchAuditLogs({
            type: auditLogEvent,
            limit: 20,
        });

        return [...logs.entries.values()];
    } catch (e) {
        console.log(`[AUDIT TYPE ERR] ${e.message}`);
    }

    try {
        const logs = await guild.fetchAuditLogs({
            limit: 20,
        });

        return [...logs.entries.values()];
    } catch (e) {
        console.log(`[AUDIT ALL ERR] ${e.message}`);
        return [];
    }
}

async function getAuditExecutor(guild, auditLogEvent, targetId = null) {
    const startTime = Date.now();

    for (let attempt = 1; attempt <= 8; attempt++) {
        await wait(1200);

        const entries = await fetchAuditEntries(guild, auditLogEvent);

        console.log(`[AUDIT] attempt ${attempt} — entries: ${entries.length}`);

        printAuditDebug(entries);

        let entry = null;

        if (targetId) {
            entry = entries.find(
                (e) =>
                    e.target?.id === targetId &&
                    e.executor?.id &&
                    e.executor.id !== client.user?.id &&
                    e.createdTimestamp >= startTime - 20000
            );
        }

        if (!entry) {
            entry = entries.find(
                (e) =>
                    e.executor?.id &&
                    e.executor.id !== client.user?.id &&
                    e.createdTimestamp >= startTime - 20000
            );
        }

        if (entry) {
            console.log(`[AUDIT] attempt ${attempt} — found executor: ${entry.executor.id}`);
            return entry.executor;
        }

        console.log(`[AUDIT] attempt ${attempt} — no valid executor yet`);
    }

    console.log(`[AUDIT] gave up after 8 attempts`);
    return null;
}

async function removeAllRoles(member) {
    const botMember = member.guild.members.me;

    if (!botMember) {
        console.log('[PUNISH] bot member not found');
        return 'bot_member_not_found';
    }

    const botHighestPosition = botMember.roles.highest.position;

    console.log(`[PUNISH] bot highest pos: ${botHighestPosition}`);
    console.log(`[PUNISH] target highest pos: ${member.roles.highest.position}`);

    const removable = member.roles.cache.filter(
        (role) =>
            role.id !== member.guild.id &&
            !role.managed &&
            role.position < botHighestPosition
    );

    const notRemovable = member.roles.cache.filter(
        (role) =>
            role.id !== member.guild.id &&
            (role.managed || role.position >= botHighestPosition)
    );

    console.log(`[PUNISH] removable: ${removable.map((r) => r.name).join(', ') || 'none'}`);
    console.log(`[PUNISH] NOT removable: ${notRemovable.map((r) => r.name).join(', ') || 'none'}`);

    if (removable.size === 0) return 'no_removable_roles';

    await member.roles.remove([...removable.keys()], 'Protection system');
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
    console.log(`[PUNISH] called — executor:${executor.id} reason:${reason}`);

    if (isIgnored(executor.id)) {
        console.log('[PUNISH] ignored');
        return;
    }

    if (isPunishmentOnCooldown(guild.id, executor.id, reason)) {
        console.log('[PUNISH] cooldown');
        return;
    }

    try {
        await log(guild, `Punishing <@${executor.id}> — ${reason}`);

        const member = await guild.members.fetch(executor.id);

        console.log(`[PUNISH] fetched member: ${member.user.tag}`);

        const result = await removeAllRoles(member);

        console.log(`[PUNISH] result: ${result}`);

        await log(guild, `Done: ${result}`);
        await sendPunishLog(guild, executor, reason);
    } catch (e) {
        console.log(`[PUNISH ERR] ${e?.message ?? e}`);
        await log(guild, `ERROR: ${e?.message ?? e}`);
    }
}

async function storeGuildRoles(guild) {
    const roles = await guild.roles.fetch();

    for (const [, role] of roles) {
        storedRolePositions.set(`${guild.id}:${role.id}`, role.rawPosition);
    }

    console.log(`[STORE] ${guild.name}: stored ${roles.size} roles`);
}

async function storeGuildChannels(guild) {
    const channels = await guild.channels.fetch();

    for (const [, channel] of channels) {
        if (channel) {
            storedChannelPositions.set(`${guild.id}:${channel.id}`, channel.rawPosition ?? 0);
        }
    }

    console.log(`[STORE] ${guild.name}: stored ${channels.size} channels`);
}

client.once('clientReady', async () => {
    console.log(`[Bot] Online as ${client.user.tag}`);

    for (const [, guild] of client.guilds.cache) {
        try {
            await storeGuildRoles(guild);
        } catch (e) {
            console.log(`[Bot] Failed roles fetch: ${e.message}`);
        }

        try {
            await storeGuildChannels(guild);
        } catch (e) {
            console.log(`[Bot] Failed channels fetch: ${e.message}`);
        }
    }

    console.log(`[Bot] Total role positions stored: ${storedRolePositions.size}`);
    console.log(`[Bot] Total channel positions stored: ${storedChannelPositions.size}`);
    console.log('[Bot] Protection active');
});

client.on('roleCreate', async (role) => {
    const key = `${role.guild.id}:${role.id}`;
    storedRolePositions.set(key, role.rawPosition);

    console.log(`[roleCreate] ${role.name}`);

    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);

        if (!executor) {
            console.log('[roleCreate] no executor');
            return;
        }

        if (isIgnored(executor.id)) {
            console.log('[roleCreate] ignored');
            return;
        }

        await role.delete('Protection').catch((e) => {
            console.log(`[roleCreate delete ERR] ${e.message}`);
        });

        storedRolePositions.delete(key);

        await punish(role.guild, executor, 'اضافة رتبه جديده');
    } catch (e) {
        console.log(`[roleCreate ERR] ${e.message}`);
    }
});

client.on('roleDelete', async (role) => {
    const key = `${role.guild.id}:${role.id}`;
    const savedPosition = storedRolePositions.get(key) ?? role.rawPosition;

    storedRolePositions.delete(key);

    console.log(`[roleDelete] ${role.name} savedPosition:${savedPosition}`);

    try {
        const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

        if (!executor) {
            console.log('[roleDelete] no executor');
            return;
        }

        if (isIgnored(executor.id)) {
            console.log('[roleDelete] ignored');
            return;
        }

        const recreated = await role.guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            mentionable: role.mentionable,
            reason: 'Protection',
        }).catch((e) => {
            console.log(`[roleDelete create ERR] ${e.message}`);
            return null;
        });

        if (recreated) {
            storedRolePositions.set(`${role.guild.id}:${recreated.id}`, savedPosition);

            await wait(1000);

            await recreated.setPosition(savedPosition, { relative: false }).catch((e) => {
                console.log(`[roleDelete setPosition ERR] ${e.message}`);
            });
        }

        await punish(role.guild, executor, 'حذف رتبه');
    } catch (e) {
        console.log(`[roleDelete ERR] ${e.message}`);
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const key = `${newRole.guild.id}:${newRole.id}`;
        const storedPosition = storedRolePositions.get(key);

        if (storedPosition === undefined) {
            storedRolePositions.set(key, newRole.rawPosition);
            console.log(`[roleUpdate] no stored position for ${newRole.name}, saved now`);
            return;
        }

        const nameChanged = oldRole.name !== newRole.name;
        const colorChanged = oldRole.color !== newRole.color;
        const permissionsChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
        const mentionableChanged = oldRole.mentionable !== newRole.mentionable;
        const hoistChanged = oldRole.hoist !== newRole.hoist;
        const positionChanged = storedPosition !== newRole.rawPosition;

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
            `[roleUpdate] ${newRole.name} | name:${nameChanged} color:${colorChanged} perms:${permissionsChanged} mention:${mentionableChanged} hoist:${hoistChanged} pos:${positionChanged} stored:${storedPosition} new:${newRole.rawPosition}`
        );

        if (positionChanged) {
            if (botRestoringRoles.has(newRole.guild.id)) {
                console.log('[roleUpdate] bot restore event ignored');
                storedRolePositions.set(key, newRole.rawPosition);
                return;
            }

            let executorPromise = guildRoleAuditPromises.get(newRole.guild.id);

            if (!executorPromise) {
                console.log('[roleUpdate] starting audit lookup...');

                executorPromise = getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, null);
                guildRoleAuditPromises.set(newRole.guild.id, executorPromise);

                setTimeout(() => {
                    guildRoleAuditPromises.delete(newRole.guild.id);
                }, 15000);
            }

            const executor = await executorPromise;

            if (botRestoringRoles.has(newRole.guild.id)) {
                console.log('[roleUpdate] bot restore event ignored after audit');
                storedRolePositions.set(key, newRole.rawPosition);
                return;
            }

            botRestoringRoles.add(newRole.guild.id);

            setTimeout(() => {
                botRestoringRoles.delete(newRole.guild.id);
            }, 10000);

            console.log(`[roleUpdate] restoring ${newRole.name} from ${newRole.rawPosition} to ${storedPosition}`);

            await log(
                newRole.guild,
                `Role moved: ${newRole.name} — restoring from ${newRole.rawPosition} to ${storedPosition}`
            );

            await newRole.setPosition(storedPosition, { relative: false }).catch((e) => {
                console.log(`[roleUpdate setPosition ERR] ${e.message}`);
            });

            storedRolePositions.set(key, storedPosition);

            if (!executor) {
                console.log('[roleUpdate] no executor — restored role but cannot punish');
                await log(newRole.guild, 'رجعت الرتبة مكانها، لكن ما قدرت أعرف مين حرّكها من Audit Log');
                return;
            }

            if (isIgnored(executor.id)) {
                console.log('[roleUpdate] executor ignored');
                return;
            }

            await punish(newRole.guild, executor, 'تغيير مكان رتبه');
            return;
        }

        let reason = 'تعديل رتبه';

        if (nameChanged) reason = 'تغيير اسم رتبه';
        else if (colorChanged) reason = 'تغيير لون رتبه';
        else if (permissionsChanged) reason = 'تغيير صلاحيات رتبه';
        else if (mentionableChanged) reason = 'تغيير منشن رتبه';
        else if (hoistChanged) reason = 'تغيير ظهور رتبه';

        const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

        if (nameChanged) {
            await newRole.setName(oldRole.name).catch((e) => {
                console.log(`[roleUpdate setName ERR] ${e.message}`);
            });
        }

        if (colorChanged) {
            await newRole.setColor(oldRole.color).catch((e) => {
                console.log(`[roleUpdate setColor ERR] ${e.message}`);
            });
        }

        if (permissionsChanged) {
            await newRole.setPermissions(oldRole.permissions).catch((e) => {
                console.log(`[roleUpdate setPermissions ERR] ${e.message}`);
            });
        }

        if (mentionableChanged) {
            await newRole.setMentionable(oldRole.mentionable).catch((e) => {
                console.log(`[roleUpdate setMentionable ERR] ${e.message}`);
            });
        }

        if (hoistChanged) {
            await newRole.setHoist(oldRole.hoist).catch((e) => {
                console.log(`[roleUpdate setHoist ERR] ${e.message}`);
            });
        }

        if (!executor) {
            console.log('[roleUpdate] no executor for normal role update — restored only');
            return;
        }

        if (isIgnored(executor.id)) return;

        await punish(newRole.guild, executor, reason);
    } catch (e) {
        console.log(`[roleUpdate ERR] ${e.message}`);
    }
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;

    const key = `${channel.guild.id}:${channel.id}`;
    storedChannelPositions.set(key, channel.rawPosition ?? 0);

    console.log(`[channelCreate] ${channel.name}`);

    try {
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

        if (!executor) {
            console.log('[channelCreate] no executor');
            return;
        }

        if (isIgnored(executor.id)) {
            console.log('[channelCreate] ignored');
            return;
        }

        await channel.delete('Protection').catch((e) => {
            console.log(`[channelCreate delete ERR] ${e.message}`);
        });

        storedChannelPositions.delete(key);

        await punish(channel.guild, executor, 'اضافة روم');
    } catch (e) {
        console.log(`[channelCreate ERR] ${e.message}`);
    }
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;

    const key = `${channel.guild.id}:${channel.id}`;
    const savedPosition = storedChannelPositions.get(key) ?? channel.rawPosition ?? 0;

    storedChannelPositions.delete(key);

    console.log(`[channelDelete] ${channel.name} savedPosition:${savedPosition}`);

    try {
        const isCategory = channel.type === ChannelType.GuildCategory;
        const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

        if (!executor) {
            console.log('[channelDelete] no executor');
            return;
        }

        if (isIgnored(executor.id)) {
            console.log('[channelDelete] ignored');
            return;
        }

        const overwrites = channel.permissionOverwrites?.cache?.map((o) => ({
            id: o.id,
            type: o.type,
            allow: o.allow,
            deny: o.deny,
        })) ?? [];

        const createOptions = {
            name: channel.name,
            type: channel.type,
            position: savedPosition,
            permissionOverwrites: overwrites,
            reason: 'Protection',
        };

        if (!isCategory) {
            if (channel.parentId) createOptions.parent = channel.parentId;
            if (channel.topic) createOptions.topic = channel.topic;
            if (channel.nsfw !== undefined) createOptions.nsfw = channel.nsfw;
            if (channel.rateLimitPerUser) createOptions.rateLimitPerUser = channel.rateLimitPerUser;

            if (channel.type === ChannelType.GuildVoice) {
                if (channel.bitrate) createOptions.bitrate = channel.bitrate;
                if (channel.userLimit) createOptions.userLimit = channel.userLimit;
            }
        }

        const recreated = await channel.guild.channels.create(createOptions).catch((e) => {
            console.log(`[channelDelete create ERR] ${e.message}`);
            return null;
        });

        if (recreated) {
            storedChannelPositions.set(`${channel.guild.id}:${recreated.id}`, savedPosition);
        }

        const reason = isCategory ? 'حذف كاتوقري' : 'حذف روم';

        await punish(channel.guild, executor, reason);
    } catch (e) {
        console.log(`[channelDelete ERR] ${e.message}`);
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    try {
        const isCategory = newChannel.type === ChannelType.GuildCategory;
        const key = `${newChannel.guild.id}:${newChannel.id}`;

        const storedPosition = storedChannelPositions.get(key) ?? oldChannel.rawPosition ?? 0;

        const nameChanged = oldChannel.name !== newChannel.name;
        const positionChanged = storedPosition !== newChannel.rawPosition;

        const oldPerms = oldChannel.permissionOverwrites?.cache;
        const newPerms = newChannel.permissionOverwrites?.cache;

        let permChanged = false;
        let permAdded = false;

        if (oldPerms && newPerms) {
            if (newPerms.size > oldPerms.size) {
                permChanged = true;
                permAdded = true;
            } else if (newPerms.size < oldPerms.size) {
                permChanged = true;
            } else {
                for (const [id, newOverwrite] of newPerms) {
                    const oldOverwrite = oldPerms.get(id);

                    if (
                        !oldOverwrite ||
                        oldOverwrite.allow.bitfield !== newOverwrite.allow.bitfield ||
                        oldOverwrite.deny.bitfield !== newOverwrite.deny.bitfield
                    ) {
                        permChanged = true;
                        break;
                    }
                }
            }
        }

        if (!nameChanged && !positionChanged && !permChanged) return;

        console.log(
            `[channelUpdate] ${newChannel.name} | name:${nameChanged} pos:${positionChanged} perms:${permChanged} stored:${storedPosition} new:${newChannel.rawPosition}`
        );

        if (positionChanged && !nameChanged && !permChanged) {
            if (botRestoringChannels.has(newChannel.guild.id)) {
                console.log('[channelUpdate] bot restore event ignored');
                storedChannelPositions.set(key, newChannel.rawPosition ?? 0);
                return;
            }

            let executorPromise = guildChannelAuditPromises.get(newChannel.guild.id);

            if (!executorPromise) {
                console.log('[channelUpdate] starting audit lookup...');

                executorPromise = getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, null);
                guildChannelAuditPromises.set(newChannel.guild.id, executorPromise);

                setTimeout(() => {
                    guildChannelAuditPromises.delete(newChannel.guild.id);
                }, 15000);
            }

            const executor = await executorPromise;

            if (botRestoringChannels.has(newChannel.guild.id)) {
                storedChannelPositions.set(key, newChannel.rawPosition ?? 0);
                return;
            }

            botRestoringChannels.add(newChannel.guild.id);

            setTimeout(() => {
                botRestoringChannels.delete(newChannel.guild.id);
            }, 10000);

            await newChannel.setPosition(storedPosition).catch((e) => {
                console.log(`[channelUpdate setPos ERR] ${e.message}`);
            });

            storedChannelPositions.set(key, storedPosition);

            if (!executor) {
                console.log('[channelUpdate] no executor — restored channel but cannot punish');
                await log(newChannel.guild, 'رجعت الروم مكانه، لكن ما قدرت أعرف مين حرّكه من Audit Log');
                return;
            }

            if (isIgnored(executor.id)) {
                console.log('[channelUpdate] executor ignored');
                return;
            }

            const reason = isCategory ? 'حرك كاتوقري' : 'حرك روم';

            await punish(newChannel.guild, executor, reason);
            return;
        }

        let reason = 'تعديل روم';

        if (nameChanged) {
            reason = 'غير اسم روم او شات';
        } else if (permChanged) {
            if (isCategory) {
                reason = permAdded ? 'اضاف رتبه في كاتوقري' : 'حذف رتبه في كاتوقري';
            } else {
                reason = permAdded ? 'اضاف رتبه في روم او شات' : 'حذف رتبه في روم او شات';
            }
        }

        const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);

        if (nameChanged) {
            await newChannel.setName(oldChannel.name).catch((e) => {
                console.log(`[channelUpdate setName ERR] ${e.message}`);
            });
        }

        if (permChanged && oldPerms) {
            await newChannel.permissionOverwrites.set(
                oldPerms.map((o) => ({
                    id: o.id,
                    type: o.type,
                    allow: o.allow,
                    deny: o.deny,
                }))
            ).catch((e) => {
                console.log(`[channelUpdate perms ERR] ${e.message}`);
            });
        }

        if (!executor) {
            console.log('[channelUpdate] no executor — restored only');
            return;
        }

        if (isIgnored(executor.id)) return;

        await punish(newChannel.guild, executor, reason);
    } catch (e) {
        console.log(`[channelUpdate ERR] ${e.message}`);
    }
});

if (!TOKEN) {
    console.log('[Bot] TOKEN is missing from environment variables');
    process.exit(1);
}

client.login(TOKEN);
