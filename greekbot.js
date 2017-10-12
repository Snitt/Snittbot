const discord = require('discord.js');
const bot = new discord.Client();
const ms = require("ms");
var request = require('request');
const fs = module.require("fs");
var imgur = require('imgur');
var Promise = require('promise');
var moment = require('moment');

const config = require("./config.json");
const twitchStatus = require("./twitchstatus.json");

const sql = require("sqlite");
sql.open("./punishments.sqlite");

bot.on("ready", () => {
    console.log("Bot ready config: " + config.configType);
    bot.setInterval(() => {
        sql.all("SELECT * FROM punishments").then(rows => {
            rows.forEach((row) => {
                if (row.time < Date.now()) {
                    let guild = bot.guilds.get(config.guildID);
                    let mutedrole = guild.roles.find(r => r.name === "Muted");
                    let punishedrole = guild.roles.find(r => r.name === "Punished");
                    let member = guild.members.get(row.userId);
                    if (row.punishment == "MUTE") {
                        sql.run("DELETE FROM punishments WHERE time=(?)", row.time).then(err => {
                            console.log("Deleted " + row.userName + "'s " + row.punishment);
                        });
                        if (member) {
                            member.removeRole(mutedrole);
                            member.setMute(false);
                            logUnmute(member, bot.user, "Auto - Punishment complete");
                        }
                    } else if (row.punishment == "PUNISH") {
                        sql.run("DELETE FROM punishments WHERE time=(?)", row.time).then(err => {
                            console.log("Deleted " + row.userName + "'s " + row.punishment);
                        });
                        if (member) {
                            member.removeRole(punishedrole);
                            logUnpunish(member, bot.user, "Auto - Punishment complete");
                        }
                    }
                }
            })
        }).catch(() => {
            console.error;
            console.log("Hit the catch");
        });
    }, 5000)


});

bot.on("messageDelete", message => {
    if (message.author.bot) return;
    logMessageDelete(message);
})

bot.on("messageUpdate", (oldMessage, newMessage) => {
    if (oldMessage.author.bot) return;
    logMessageEdit(oldMessage, newMessage);
})

bot.on("guildMemberAdd", member => {
    console.log("A user joined");
    let guild = member.guild;
    let muteRole = member.guild.roles.find("name", "Muted");
    let punishRole = member.guild.roles.find("name", "Punished");

    sql.all(`SELECT * FROM punishments WHERE userId =(?)`, member.id).then(rows => {
        rows.forEach((row) => {
            if (row.punishment == "MUTE") {
                console.log("New user joined who was muted.");
                member.addRole(muteRole).catch(console.error);
                member.setMute(true);
            } else if (row.punishment == "PUNISH") {
                member.addRole(punishRole).catch(console.error);
            }
        });
    }).catch(() => {
        console.error;
    });
    logJoin(member);
});

//Distinguish between leavers and kicked
bot.on("guildMemberRemove", member => {
    logLeave(member);
})

//Check audit logs to see if mod change or user change
// bot.on("guildMemberUpdate", (oldMember, newMember) => {
//     console.log(newUser);
// })

bot.on('message', message => {
    if (message.author.bot) return;
    if (message.content.startsWith(config.prefix)) {

        let command = message.content.split(" ")[0];
        command = command.slice(config.prefix.length);
        let args = message.content.split(" ").slice(1);
        console.log(args);
        //message.delete(5000);

        if (command === "clear") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log("unauthorised member");
            let messageCount = 15;
            if (!isNaN(parseInt(args[0]))) {
                messageCount = parseInt(args[0]);
            }
            if (messageCount > 100) return message.reply("You cannot delete more than 100 messages at a time.");
            message.channel.bulkDelete(messageCount).then(messages => saveText(message, messages, messageCount));
        } else

        if (command === "mute") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log(`User not authorised`);
            let member = message.mentions.members.first();
            if (message.member == member) return message.reply("You may not target yourself");
            if (userCheck(message.member, member, message.channel))
                if (!member) return message.reply("No member specified.");
            let muteRole = message.guild.roles.find("name", "Muted");
            let time = args[1];
            let argPosition = 2;
            if (!/^(\d+)[hmsd]$/.test(time)) {
                time = config.defaultMute;
                argPosition = 1;
            }
            let muteTime = getTime(time);
            if (!muteTime) return message.reply("Time format is [amount][H/M/S/D] example 30m");
            let humanTime = ms(ms(time), {
                long: true
            });
            if (isNaN(parseInt(time.replace(/(\d+)[hmsd]/, "$1")))) return message.reply("Please use usage >action [user] [time] [reason]");
            let reason = args.slice(argPosition).join(" ");
            if (!time) return message.reply("No time specified");
            member.addRole(muteRole).catch(console.error);
            member.setMute(true);
            logMute(member, message.author, humanTime, reason);
            punishDB(message, "MUTE", member, message.author, reason, Date.now() + parseInt(muteTime) * 1000, humanTime);

        } else

        if (command === "punish") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log(`User not authorised`);
            let member = message.mentions.members.first();
            if (message.member == member) return message.reply("You may not target yourself");
            if (userCheck(message.member, member, message.channel))
                if (!member) return message.reply("No member specified.");
            let punishRole = message.guild.roles.find("name", "Punished");
            let time = args[1];
            let argPosition = 2;
            if (!/^(\d+)[hmsd]$/.test(time)) {
                time = config.defaultPunish;
                argPosition = 1;
            }
            let muteTime = getTime(time);
            if (!muteTime) return message.reply("Time format is [amount][H/M/S/D] example 30m");
            let humanTime = ms(ms(time), {
                long: true
            });
            if (isNaN(parseInt(time.replace(/(\d+)[hmsd]/, "$1")))) return message.reply("Please use usage >action [user] [time] [reason]");
            let reason = args.slice(argPosition).join(" ");
            if (!time) return message.reply("No time specified");
            member.addRole(punishRole).catch(console.error);
            logPunish(member, message.author, humanTime, reason);

            punishDB(message, "PUNISH", member, message.author, reason, Date.now() + parseInt(muteTime) * 1000, humanTime);

        } else

        if (command === "unmute") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log(`User not authorised`);
            let member = message.mentions.members.first();
            if (message.member == member) return message.reply("You may not target yourself");
            if (userCheck(message.member, member, message.channel))
                if (!member) return message.reply("No member specified.");
            let mutedrole = message.guild.roles.find(r => r.name === "Muted");
            let reason = args.slice(1).join(" ");
            member.removeRole(mutedrole);
            member.setMute(false);
            sql.run("DELETE FROM punishments WHERE userId=(?) AND punishment=(?)", member.id, "MUTE").then(err => {
                logUnmute(member, message.author, reason);
            });
        }

        if (command === "unpunish") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log(`User not authorised`);
            let member = message.mentions.members.first();
            if (message.member == member) return message.reply("You may not target yourself");
            if (userCheck(message.member, member, message.channel))
                if (!member) return message.reply("No member specified.");
            let punishedrole = message.guild.roles.find(r => r.name === "Punished");
            let reason = args.slice(1).join(" ");
            member.removeRole(punishedrole);
            sql.run("DELETE FROM punishments WHERE userId=(?) AND punishment=(?)", member.id, "PUNISH").then(err => {
                logUnpunish(member, message.author, reason);
            });
        } else

        if (command === "ban") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log(`User not authorised`);
            let member = message.mentions.members.first();
            if (message.member == member) return message.reply("You may not target yourself");
            if (userCheck(message.member, member, message.channel))
                if (!member) return message.reply("No member specified.");
            let modMember = message.author;
            let reason = args.slice(1).join(" ");
            if (!reason) {
                reason = "No reason specified!";
            }
            if (!member.bannable) return message.reply("Unable to ban this user");
            member.ban(reason);
            logBan(member, modMember, reason);
        } else

        if (command === "kick") {
            if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                return console.log(`User not authorised`);
            let member = message.mentions.members.first();
            if (message.member == member) return message.reply("You may not target yourself");
            if (userCheck(message.member, member, message.channel))
                if (!member) return message.reply("No member specified.");
            let modMember = message.author;
            let reason = args.slice(1).join(" ");
            if (!reason) {
                reason = "No reason specified!";
            }
            if (!member.kickable) return message.reply("Unable to kick this user");
            member.kick(reason);
            message.channel.send(`User ${member.user} has been Kicked for reason: ${reason}`);
            logKick(member, modMember, reason);
        } else

        if (command === "eval") {
            if (message.author.id !== config.ownerID) return console.log("Not the owner");
            const args = message.content.split(" ").slice(1);

            try {
                const code = args.join(" ");
                let evaled = eval(code);

                if (typeof evaled !== "string")
                    evaled = require("util").inspect(evaled);

                message.channel.send(clean(evaled), {
                    code: "xl"
                });
            } catch (err) {
                message.channel.send(`\`ERROR\` \`\`\`xl\n${clean(err)}\n\`\`\``);
            }

            function clean(text) {
                if (typeof(text) === "string")
                    return text.replace(/`/g, "`" + String.fromCharCode(8203)).replace(/@/g, "@" + String.fromCharCode(8203));
                else
                    return text;
            }

        } else

        if (command === "test") {
          if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
              return console.log(`User not authorised`);

          message.channel.send(calcTimeDiff(1507689412623));
        } else

            //Add time zones
            if (command === "check") {
              if (!message.member.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name)))
                  return console.log(`User not authorised`);
                let member = message.mentions.members.first();
                sql.all("SELECT * FROM punishments WHERE userId =(?)", member.id).then(rows => {
                    rows.forEach((row) => {
                      console.log(row.time);
                      console.log(moment(row.time).format('MMMM Do YYYY, hh:mm:ss a'));
                        const embed = new discord.RichEmbed()
                            .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
                            .setColor(0xFF4500)
                            .setDescription(`**Type**: *${row.punishment}*\n**Total time**: ${row.humanTime}\n**Unmuted at (GMT)**: ${moment(row.time).format('MMMM Do YYYY, hh:mm:ss a')}\n**Time remaining (hh:mm:ss)**: ${calcTimeDiff(row.time)}`)
                            //.setDescription(`**Type**: *${row.punishment}*\n**Total time**: ${row.humanTime}\n**Unmuted at (GMT)**: ${moment(row.time).format('MMMM Do YYYY, hh:mm:ss a')}`)
                            .setTimestamp()
                        message.channel.send({
                            embed
                        });
                    })
                }).catch(() => {
                    console.log("Problem");
                });

            }
        // else

        // if (command === "live") {
        //     request.get({
        //         headers: {
        //             'client-id': 'efkq4ncc0iiepo4vs1r8t01o4dj8gt'
        //         },
        //         url: 'https://api.twitch.tv/kraken/streams/greekgodx',
        //     }, function(error, response, body) {
        //         if (JSON.parse(body).stream) {
        //             //If the last known state of the stream was false(offline) then:
        //             if (!twitchStatus.live) {
        //
        //             }
        //             //message.channel.send("Greekgodx is currently **ONLINE**");
        //         } else {
        //             //Else if stream is offline
        //             //Check if last known state was online. If so update file. If not, do nothing.
        //             if (twitchStatus.live) {
        //                 twitchStatus.live = false;
        //                 fs.writeFile("./twitchstatus.json", JSON.stringify(twitchStatus, null, 4), err => {
        //                     if (err) throw err;
        //                 });
        //             }
        //             message.channel.send("Greekgodx is currently **OFFLINE**");
        //         }
        //     });
        //
        //     // CheckOnlineStatus(message);
        //}
    }
});

function CheckOnlineStatus() {
    request.get({
        headers: {
            'client-id': config.twitchKey
        },
        url: 'https://api.twitch.tv/kraken/streams/greekgodx',
    }, function(error, response, body) {
        //logClear(message, amount, JSON.parse(body).link);
        if (JSON.parse(body).stream) {
            return true;
        } else {
            return false;
        }
    });
}

function saveText(message, messages, amount) {
    var finalMessage = "";
    messages.forEach(deleted =>
        finalMessage += `[${deleted.author.username}#${deleted.author.discriminator}]: ${deleted.content}\n`);
    uploadClearLogs(message, finalMessage, amount);
}

function uploadClearLogs(message, finalMessage, amount) {
    request.post({
        headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': config.pasteKey
        },
        url: 'https://api.paste.ee/v1/pastes',
        body: JSON.stringify({
            description: 'Greekgodx logs',
            sections: [{
                "name": "Logs",
                "syntax": "text",
                "contents": `${finalMessage}`
            }]
        })
    }, function(error, response, body) {
        logClear(message, amount, JSON.parse(body).link);
    });
};

function punishDB(message, punishment, member, modMember, reason, time, humanTime) {
    console.log("punish db says " + humanTime);
    sql.get(`SELECT * FROM punishments WHERE userId =(?)`, member.id).then(row => {
        if (row) {
            if (row.punishment == punishment && row.time > Date.now()) {
                sql.run("UPDATE punishments SET time = (?), humanTime = (?) WHERE userId = (?)", time, humanTime, member.id).then(err => {
                    //Add logging to log channel for updates
                    //message.channel.send(`${row.userName} was muted by ${row.modName} until ${row.time}. This has been updated and they will now be unmuted on ${new Date(time).format("dd.mm.yyy hh:MM:ss")}.`);
                    message.channel.send(`${row.userName}'s punishment has been updated from: **${row.humanTime}** to: **${humanTime}** .`);
                    logUpdate(row.punishment, member, modMember, reason, row.humanTime, humanTime);
                })
            } else {
                sql.run(`INSERT INTO punishments (punishment, userId, userName, modId, modName, reason, time, humanTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [punishment, member.id, member.user.username, modMember.id, modMember.username, reason, time, humanTime]);
            }
        } else {
            sql.run(`INSERT INTO punishments (punishment, userId, userName, modId, modName, reason, time, humanTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [punishment, member.id, member.user.username, modMember.id, modMember.username, reason, time, humanTime]);
        }
    }).catch(() => {
        console.error;
        sql.run("CREATE TABLE IF NOT EXISTS punishments (punishment TEXT, userId TEXT, userName TEXT, modId TEXT, modName TEXT, reason TEXT, time INTEGER, humanTime TEXT)").then(() => {
            sql.run(`INSERT INTO punishments (punishment, userId, userName, modId, modName, reason, time, humanTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [punishment, member.id, member.user.username, modMember.id, modMember.username, reason, time, humanTime]);
        });
    });
}

function logJoin(member) {
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0x00FF00)
        .setDescription(`Member **Joined** | ${member.user}`)
        .setTimestamp()
    getLogChannel().send({
        embed
    });
}

function logLeave(member) {
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF4500)
        .setDescription(`Member **Left** | ${member.user}`)
        .setTimestamp()
    getLogChannel().send({
        embed
    });
}

function logMessageDelete(message) {
    if (message.attachments.size > 0) {
        uploadImage(message.attachments).then(function(link) {
            const embed = new discord.RichEmbed()
                .setAuthor(`${message.author.username}#${message.author.discriminator} | (${message.author.id})`, `${avatarCheck(message.author)}`)
                .setColor(0x00FFFF)
                .setDescription(`Message **Deleted** In ${message.channel} | ${message.author}\n\n**Message:** ${message.content}\n\n**Link:** ${link}`)
                .setTimestamp()
            getLogChannel().send({
                embed
            });
        });

    } else {
        const embed = new discord.RichEmbed()
            .setAuthor(`${message.author.username}#${message.author.discriminator} | (${message.author.id})`, `${avatarCheck(message.author)}`)
            .setColor(0x00FFFF)
            .setDescription(`Message **Deleted** In ${message.channel} | ${message.author}\n\n**Message:** ${message.content}`)
            .setTimestamp()
        getLogChannel().send({
            embed
        });
    }
}

function logMessageEdit(oldMessage, newMessage) {
    const embed = new discord.RichEmbed()
        .setAuthor(`${oldMessage.author.username}#${oldMessage.author.discriminator} | (${oldMessage.author.id})`, `${avatarCheck(oldMessage.author)}`)
        .setColor(0x00FFFF)
        .setDescription(`Message **Edited** In ${oldMessage.channel} | ${oldMessage.author}\n\n**Old message:** ${oldMessage.content}\n**New message:** ${newMessage.content}`)
        .setTimestamp()
    getLogChannel().send({
        embed
    });
}

function logClear(message, amount, url) {
    const embed = new discord.RichEmbed()
        .setAuthor(`${message.author.username}#${message.author.discriminator} | (${message.author.id})`, `${avatarCheck(message.author)}`)
        .setColor(0x00FFFF)
        .setDescription(`${amount} messages **Cleared** In ${message.channel} | ${message.author}\n\n**Link**: ${url}`)
        .setTimestamp()
    getLogChannel().send({
        embed
    });
}

function logMute(member, modMember, time, reason) {
    getMainChannel().send(`User ${member.user} has been muted for ${ms(ms(time), {long: true})}`);
    if (!reason) {
        reason = "No reason specified!";
    }
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF4500)
        .setDescription(`Member **Muted** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Data**: ${time}\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logPunish(member, modMember, time, reason) {
    getMainChannel().send(`User ${member.user} has been Punished for ${ms(ms(time), {long: true})}`);
    if (!reason) {
        reason = "No reason specified!";
    }
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF4500)
        .setDescription(`Member **Punished** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Data**: ${time}\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logUnmute(member, modMember, reason) {
    getMainChannel().send(`User ${member.user} has been unmuted`);
    if (!reason) {
        reason = "No reason specified!";
    }
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF4500)
        .setDescription(`Member **Unmuted** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logUnpunish(member, modMember, reason) {
    getMainChannel().send(`User ${member.user} has been unpunished`);
    if (!reason) {
        reason = "No reason specified!";
    }
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF4500)
        .setDescription(`Member **Unpunish** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logBan(member, modMember, reason) {
    getMainChannel().send(`User ${member.user} has been Banned for reason: ${reason}`);
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF0000)
        .setDescription(`Member **Banned** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logKick(member, modMember, reason) {
    getMainChannel().send(`User ${member.user} has been Kicked for reason: ${reason}`);
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF0000)
        .setDescription(`Member **Kicked** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logUserChange(oldUser, newUser) {
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0xFF4500)
        .setDescription(`Member **Kicked** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function logUpdate(punishment, member, modMember, reason, oldTime, newTime) {
    //getMainChannel().send(`User ${member.user} has been Banned for reason: ${reason}`);
    var punishType = "Error";
    if (punishment == "MUTE") {
        punishType = "Mute";
    } else if (punishment == "PUNISH") {
        punishType = "Punish";
    }
    const embed = new discord.RichEmbed()
        .setAuthor(`${member.user.username}#${member.user.discriminator} | (${member.user.id})`, `${avatarCheck(member.user)}`)
        .setColor(0x00AE86)
        .setDescription(`${punishType} duration **Updated** | ${member.user}\n\n**Mod**: ${modMember.username}#${modMember.discriminator} | (${modMember.id})\n**Old Time**: ${oldTime}\n**New Time**: ${newTime}\n**Reason**: ${reason}`)
        .setTimestamp()
    getReasonChannel().send({
        embed
    });
}

function calcTimeDiff(time) {
  var diff = time - parseInt(Date.now());
  return moment(moment.duration(diff, "ms").asMilliseconds()).format("HH:mm:ss");
}

function getMainChannel() {
    return bot.channels.get(config.mainChannel);
}

function getLogChannel() {
    return bot.channels.get(config.logChannel);
}

function getReasonChannel() {
    return bot.channels.get(config.reasonChannel);
}

function avatarCheck(member) {
    if (member.avatarURL) {
        return member.avatarURL;
    } else {
        return "https://pbs.twimg.com/profile_images/901137719492919296/z6Xlxxj4_400x400.jpg";
    }
}

function uploadImage(attachments) {
    return new Promise(function(fulfill, reject) {
        attachments.forEach(function(attachment) {
            if (attachment.width) {
                console.log("TRYING TO UPLOAD URL: " + attachment.url);
                //imgur.uploadUrl("https://www.mathconsult.ch/static/unipoly/33.256.gif")
                imgur.uploadUrl(attachment.url)
                    .then(function(json) {
                        fulfill(json.data.link);
                        console.log("UPLOADED " + attachment.url + " AND OBTAINED URL: " + json.data.link);
                    })
                    .catch(function(err) {
                        console.error(err.message);
                        reject(err.message);
                    });
            }
        });
    });
}

function getTime(time) {
    if (/(\d+)(seconds|Seconds|[Ss])/.test(time)) {
        return parseInt(time);
    } else if (/(\d+)(minutes|Minutes|[Mm])/.test(time)) {
        return parseInt(time) * 60;
    } else if (/(\d+)(hours|Hours|[Hh])/.test(time)) {
        return parseInt(time) * 60 * 60;
    } else if (/(\d+)(days|Days|[Dd])/.test(time)) {
        return parseInt(time) * 60 * 60 * 24;
    } else {
        return false;
    }
}

function userCheck(mod, targetUser, responseChannel) {
    if (!targetUser.roles.some(r => ["Chat Moderator", "Server Admins", "Alpha Moderator"].includes(r.name))) return false;
    if (mod.roles.some(r => ["Server Admins"].includes(r.name))) {
        if (targetUser.roles.some(r => ["Server Admins"].includes(r.name))) {
            responseChannel.send("An admin cannot target another admin");
            return true;
        } else {
            return false;
        }
    } else if (mod.roles.some(r => ["Alpha Moderator"].includes(r.name))) {
        if (targetUser.roles.some(r => ["Server Admins", "Alpha Moderator"].includes(r.name))) {
            responseChannel.send("Alpha mods cannot target people with higher or equal power");
            return true;
        } else {
            return false;
        }
    } else if (mod.roles.some(r => ["Chat Moderator"].includes(r.name))) {
        responseChannel.send("Chat mods can't target staff");
        return true;
    } else {
        return false;
    }
}


bot.login(config.token);

//  if(command === "eval"){
//    if(message.author.id !== "140153853600464896") return;
//  }

//msg.react("👍").then(() => msg.react("👎"))

//Questions
//Do we want the bot to @ the person punished or muted?
//How quickly should a message be deleted after it's posted, should it be deleted?

//To Do:
//Show which mod took which action by searching audit logs.
//Limit permissions to only mods
//Remove the >clear from clear log in paste.ee. remove this from deleted messages too.
//unmute and unpunish
//Sort time out to time properly
//Add if(!) conditions to properly feedback issues
//Add catch to end of most functions to catch errors and prevent bot crashes
//Allow name param to be user object or user with ID
//Twitch integration
//Reddit integration
//Logs: role add/remove, nick change, unbans
//Delete last messages on mute/punish
//upload attachments to imgur
//slowmode
//Long edits to be sent to single pastebin with before and after text on it. Shortern url.
//Give nicer time output when updating


//Changes since last version
//Additional data validation
//Moved to a database
//Mutes are now updatable - new UPDATE log(s)
//Unmutes done via bot are now logged as bot unmutes
//Unmutes done via bot are now mentioned in pleb central.


//Add DB for all functions not just mute
//Add logging channel which is never deleted from - Should include optional field for logs
//Add command to get all current mutes with time remaining
//Updated mutes should have a log function
//Sort out time to feed back time muted/updated
//Ensure unmutes are logged properly
//Don't give "Has been muted" message for re-mutes
