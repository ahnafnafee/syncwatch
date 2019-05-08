'use strict';

const express = require('express');
const socketIO = require('socket.io');
const http = require('http');

const PORT = process.env.PORT || 8080;

const server = express()
	.use(express.static(`${ __dirname }/public`))
	.listen(PORT, ()=> console.log(`Listening on ${ PORT }`));

const io = socketIO(server);
const wakeServerTime = 20;	// in minutes
const afkTime = 15;			// in minutes

let debug = false;
let roomsLength = 0;
let rooms = [], roomid = [];
let wake = false;
let countConnections = 0;

function wakeServer(status)
{
	if (status)
	{
		wake = setInterval(()=>
		{
			if (!debug) http.get('http://syncevent.herokuapp.com');
			console.log('Server waked!');
			printStatus();
		}, wakeServerTime * 60000);
	}
	else
	{
		clearInterval(wake);
		wake = false;
	}
}

function printStatus()
{
	console.log(`${ countConnections } user(s), ${ roomsLength } room(s)`);
}

function checkUserNameAndRoom(data)
{
	if (String(data.name) === '[object Object]' || String(data.room) === '[object Object]') return 'Dont try make subrooms :D';
	else
	{
		if (data.name === '' || data.name === undefined)
			return 'socket_error_write_name';
		else if (data.name.length < 2 || data.name.length > 24)
			return 'socket_error_name_length';
		else if (data.room === '' || data.name === undefined)
			return 'socket_error_write_room';
		else if (data.room.length < 2 || data.room.length > 24)
			return 'socket_error_room_length';
		else return null;
	}
}

function disconnectAfk(users)
{
	for (let user in users)
	{
		io.in(user).emit('afk');
	}
}
class Room
{
	constructor(name)
	{
		this.name = name;
		this.event = null;
		this.timeUpdated = null;
		this.users = [];
		this.usersLength = 0;
		this.share = null;
		this.afkTimer = null;
	}

	addUser(socket_id, name)
	{
		if (this.users[socket_id] === undefined)
		{
			this.users[socket_id] = name;
			this.usersLength++;
		}

		this.setAfkTimer();
	}

	disconnectUser(socket_id)
	{
		if (debug) console.log(`${ this.name }: ${ this.getUser(socket_id) } disconnected`);
		delete this.users[socket_id];
		this.usersLength--;

		this.setAfkTimer();
	}

	getUser(socket_id)
	{
		return this.users[socket_id];
	}

	getUsersNames()
	{
		let list = [];
		for (let key in this.users) list.push(this.users[key]);
		return list.sort();
	}

	nullUsers()
	{
		if (!this.usersLength) return true;
		else return false;
	}

	setAfkTimer()
	{
		if (this.usersLength === 1)
		{
			this.afkTimer = setTimeout(disconnectAfk, afkTime * 60000, this.users);
		}
		else
		{
			clearTimeout(this.afkTimer);
		}
	}
}

io.on('connection', (socket)=>
{
	countConnections++;
	if (!wake) wakeServer(true);

	socket.on('join', (data)=>
	{
		let err = checkUserNameAndRoom(data);
		if (err !== null)
		{
			socket.error(err);
			socket.disconnect();
			if (debug) console.log(`Error join: ${ err }`);
		}
		else
		{
			socket.join(data.room);
			let room = rooms[data.room];
			if (room !== undefined)
			{
				room.addUser(socket.id, data.name);
				io.in(room.name).emit('usersList', {'list': room.getUsersNames()});
				if (room.share !== null) socket.emit('share', room.share);
				if (room.usersLength > 1 && room.timeUpdated !== null)
				{
					room.event.currentTime = room.event.type === 'play' ? room.event.currentTime + 
					(Date.now() - room.timeUpdated) / 1000 : room.event.currentTime;
					// Time is about second earlier then needed
					socket.send(room.event);
				}
			}
			else
			{
				room = new Room(data.room);
				roomsLength++;
				room.addUser(socket.id, data.name);
				rooms[data.room] = room;
				socket.emit('usersList', {'list': rooms[data.room].getUsersNames()});
			}
			roomid[socket.id] = room;
	
			if (debug) console.log(`connected: ${ countConnections } ${ JSON.stringify(data) }`);
		}
	});

	socket.on('message', (msg)=>
	{
		let room = roomid[socket.id];
		if (room !== undefined)
		{
			room.event = msg;
			room.timeUpdated = Date.now();
			socket.broadcast.to(room.name).send(room.event);
			if (debug) console.log(`${ room.name }: ${ room.getUser(socket.id) } ${ JSON.stringify(msg) }`);
		}
	});

	socket.on('share', (msg)=>
	{
		let room = roomid[socket.id];
		room.share = msg;
		socket.broadcast.to(room.name).emit('share', room.share);
		if (debug) console.log(`${ room.name } shared ${ JSON.stringify(msg) }`);
	});

	socket.on('disconnect', ()=>
	{
		let room = roomid[socket.id];
		if (room !== undefined)
		{
			room.disconnectUser(socket.id);
			io.sockets.in(room.name).emit('usersList', {'list': room.getUsersNames()});
			if (room.nullUsers())
			{
				delete rooms[room.name];
				delete roomid[socket.id];
				roomsLength--;
			}
			if (roomsLength === 0)
			{
				rooms = [];
				roomid = [];
				if (global.gc)
				{
					gc();
					console.log('Collected garbage!');
				}
				console.log('All authorized users disconnected!');
			}
		}
//		else console.log('try disconnect undefined user');

		countConnections--;
		
		if (countConnections === 0)
		{
			wakeServer(false);
			console.log(`All connections aborted, server will shutdown in about 30 minutes`);
		}
	});
});