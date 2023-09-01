import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { hash } from "./util";
import { getRedisClient } from "./redis";

export const privateKey = readFileSync("keys/vodka.key", "utf-8");
export const publicKey = readFileSync("keys/vodka.key.pub", "utf-8");

export interface WebsiteData {
	name: string;
	domain: string;
}

export interface VodkaUserData {
	email: string;
	firstname?: string;
	lastname?: string;
	isStudent?: boolean;
}

interface SessionTokenData {
	// Email
	sub: string;
	// Token type
	type: "session";
}

interface MessageTokenData {
	// Email
	sub: string;
	// Domain
	target: string;
	// User data
	user: VodkaUserData;
}

// this function creates a new vodka session token, used to authenticate users on vodka
// a vodka session token only contains an email address
export const signSessionToken = (data: SessionTokenData) => {
	return jwt.sign(data, privateKey, { algorithm: "RS256" });
};

// this is used to add the signed session token to the redis whitelist
// if the database is wiped, all users will be logged out
// THIS WORKS FOR BOTH VODKA AND EXTERNAL SESSION TOKENS
export const rememberSessionToken = async (token: string) => {
	const tokenHash = hash(token);

	const redisClient = await getRedisClient();
	await redisClient.set(`session_${tokenHash}`, "1");
};

export const invalidateVodkaSessionToken = async (token: string) => {
	const tokenHash = hash(token);

	const redisClient = await getRedisClient();
	await redisClient.del(`session_${tokenHash}`);

	const messageTokenHashes = await redisClient.sMembers(
		`session_${tokenHash}_external`,
	);

	for (const messageTokenHash of messageTokenHashes) {
		await redisClient.del(`session_${messageTokenHash}`);
	}
};

// this function verifies if a session token is signed AND whitelisted
// THIS WORKS FOR BOTH SESSION TOKENS AND MESSAGE TOKENS
export const decodeToken = async (
	token: string,
): Promise<SessionTokenData | MessageTokenData | false> => {
	const tokenHash = hash(token);

	const redisClient = await getRedisClient();
	const exists = await redisClient.exists(`session_${tokenHash}`);

	if (!exists) {
		return false;
	}

	try {
		jwt.verify(token, publicKey);
		return jwt.decode(token) as SessionTokenData | MessageTokenData;
	} catch (e) {
		return false;
	}
};

// this function creates a new message token, used to transfer data to external websites
// this session token is a JWT and contains all the user data
export const signMessageToken = (data: MessageTokenData) => {
	return jwt.sign(data, privateKey, { algorithm: "RS256" });
};

// this function links an message token to a session token
// this is useful so when a user logs out of vodka, we can un-whitelist all the message tokens
export const linkMessageTokenToSessionToken = async (
	vodkaSessionToken: string,
	messageToken: string,
) => {
	const vodkaSessionTokenHash = hash(vodkaSessionToken);

	const redisClient = await getRedisClient();
	await redisClient.sAdd(
		`session_${vodkaSessionTokenHash}_external`,
		hash(messageToken),
	);
};
