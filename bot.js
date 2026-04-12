client.on('roleUpdate', async (oldRole, newRole) => {
  if (newRole.managed) return;

  const key = roleKey(newRole.guild.id, newRole.id);

  // تجاهل إذا البوت هو اللي عدل
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

  // ❗️ إذا تغير المكان فقط → يرجع مباشرة بدون Audit Log
  if (positionChanged && !propsChanged) {
    if (restoringPositions.has(newRole.guild.id)) {
      saveRole(newRole);
      return;
    }

    markBotAction(key);
    restoringPositions.add(newRole.guild.id);

    await newRole.setPosition(snapshot.rawPosition, { relative: false })
      .catch(err => {
        console.log(`[RESTORE POS ERR] ${snapshot.name} — ${err.message}`);
      });

    restoringPositions.delete(newRole.guild.id);

    await sendLog(newRole.guild, `رجعت مكان رتبة: ${snapshot.name}`);

    return;
  }

  // ❗️ إذا تغيرت الخصائص
  if (propsChanged) {
    markBotAction(key);

    await newRole.edit({
      name: snapshot.name,
      color: snapshot.color,
      hoist: snapshot.hoist,
      mentionable: snapshot.mentionable,
      permissions: BigInt(snapshot.permissions),
    }, 'Protection rollback role').catch(() => {});

    if (positionChanged) {
      await newRole.setPosition(snapshot.rawPosition, { relative: false })
        .catch(() => {});
    }

    await sendLog(newRole.guild, `رجعت تعديل رتبة: ${snapshot.name}`);
  }

  // تحديث التخزين بعد كل شيء
  const freshRoles = await newRole.guild.roles.fetch().catch(() => null);
  if (freshRoles) {
    for (const [, role] of freshRoles) {
      if (!role.managed) saveRole(role);
    }
  }
client.login(TOKEN)
