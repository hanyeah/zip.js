/* global crypto, TextEncoder */

(globalThis => {

	"use strict";

	const ERR_INVALID_PASSORD = "Invalid pasword";
	const BLOCK_LENGTH = 16;
	const PBKDF2_ALGORITHM = { name: "PBKDF2" };
	const SIGNATURE_ALGORITHM = { name: "HMAC" };
	const HASH_FUNCTION = "SHA-1";
	const CRYPTO_KEY_ALGORITHM = { name: "AES-CTR" };
	const BASE_KEY_ALGORITHM = Object.assign({ hash: SIGNATURE_ALGORITHM }, PBKDF2_ALGORITHM);
	const DERIVED_BITS_ALGORITHM = Object.assign({ iterations: 1000, hash: { name: HASH_FUNCTION } }, PBKDF2_ALGORITHM);
	const AUTHENTICATION_ALGORITHM = Object.assign({ hash: HASH_FUNCTION }, SIGNATURE_ALGORITHM);
	const CRYPTO_ALGORITHM = Object.assign({ length: BLOCK_LENGTH }, CRYPTO_KEY_ALGORITHM);
	const DERIVED_BITS_USAGE = ["deriveBits"];
	const SIGN_USAGE = ["sign"];
	const DERIVED_BITS_LENGTH = 528;
	const PREAMBULE_LENGTH = 18;
	const SIGNATURE_LENGTH = 10;
	const COUNTER_DEFAULT_VALUE = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

	class ZipDecrypt {

		constructor(password, signed) {
			this.password = password;
			this.signed = signed;
			this.input = signed && new Uint8Array(0);
			this.pendingInput = new Uint8Array(0);
		}

		async append(input) {
			const decrypt = async (offset = 0) => {
				if (offset + BLOCK_LENGTH < buferredInput.length - SIGNATURE_LENGTH) {
					const chunkToDecrypt = buferredInput.subarray(offset, offset + BLOCK_LENGTH);
					const outputChunk = await crypto.subtle.decrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.decryption, chunkToDecrypt);
					incrementCounter(this.counter);
					output.set(new Uint8Array(outputChunk), offset);
					return decrypt(offset + BLOCK_LENGTH);
				} else {
					this.pendingInput = buferredInput.subarray(offset);
					if (this.signed) {
						this.input = concat(this.input, input);
					}
					return output;
				}
			};

			if (this.password) {
				const preambule = input.subarray(0, PREAMBULE_LENGTH);
				await createDecryptionKeys(this, preambule, this.password);
				this.password = null;
				input = input.subarray(PREAMBULE_LENGTH);
			}
			let output = new Uint8Array(input.length - SIGNATURE_LENGTH - ((input.length - SIGNATURE_LENGTH) % BLOCK_LENGTH));
			let buferredInput = input;
			if (this.pendingInput.length) {
				buferredInput = concat(this.pendingInput, input);
				output = expand(output, buferredInput.length - SIGNATURE_LENGTH - ((buferredInput.length - SIGNATURE_LENGTH) % BLOCK_LENGTH));
			}
			return decrypt();
		}

		async flush() {
			const chunkToDecrypt = this.pendingInput.subarray(0, this.pendingInput.length - SIGNATURE_LENGTH);
			const originalSignatureArray = this.pendingInput.subarray(this.pendingInput.length - SIGNATURE_LENGTH);
			let decryptedChunkArray = new Uint8Array(0);
			if (chunkToDecrypt.length) {
				const decryptedChunk = await crypto.subtle.decrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.decryption, chunkToDecrypt);
				decryptedChunkArray = new Uint8Array(decryptedChunk);
			}
			let valid = true;
			if (this.signed) {
				const signature = await crypto.subtle.sign(SIGNATURE_ALGORITHM, this.keys.authentication, this.input.subarray(0, this.input.length - SIGNATURE_LENGTH));
				const signatureArray = new Uint8Array(signature);
				this.input = null;
				for (let indexSignature = 0; indexSignature < SIGNATURE_LENGTH; indexSignature++) {
					if (signatureArray[indexSignature] != originalSignatureArray[indexSignature]) {
						valid = false;
					}
				}
			}
			return {
				valid,
				data: decryptedChunkArray
			};
		}

	}

	class ZipEncrypt {

		constructor(password) {
			this.password = password;
			this.output = new Uint8Array(0);
			this.pendingInput = new Uint8Array(0);
		}

		async append(input) {
			const encrypt = async (offset = 0) => {
				if (offset + BLOCK_LENGTH <= input.length) {
					const chunkToEncrypt = input.subarray(offset, offset + BLOCK_LENGTH);
					const outputChunk = await crypto.subtle.encrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.encryption, chunkToEncrypt);
					incrementCounter(this.counter);
					output.set(new Uint8Array(outputChunk), offset + preambule.length);
					return encrypt(offset + BLOCK_LENGTH);
				} else {
					this.pendingInput = input.subarray(offset);
					this.output = concat(this.output, output);
					return output;
				}
			};

			let preambule = new Uint8Array(0);
			if (this.password) {
				preambule = await createEncryptionKeys(this, this.password);
				this.password = null;
			}
			let output = new Uint8Array(preambule.length + input.length - (input.length % BLOCK_LENGTH));
			output.set(preambule, 0);
			if (this.pendingInput.length) {
				input = concat(this.pendingInput, input);
				output = expand(output, input.length - (input.length % BLOCK_LENGTH));
			}
			return encrypt();
		}

		async flush() {
			let encryptedChunkArray = new Uint8Array(0);
			if (this.pendingInput.length) {
				const encryptedChunk = await crypto.subtle.encrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.encryption, this.pendingInput);
				encryptedChunkArray = new Uint8Array(encryptedChunk);
				this.output = concat(this.output, encryptedChunkArray);
			}
			const signature = await crypto.subtle.sign(SIGNATURE_ALGORITHM, this.keys.authentication, this.output.subarray(PREAMBULE_LENGTH));
			this.output = null;
			const signatureArray = new Uint8Array(signature).subarray(0, SIGNATURE_LENGTH);
			return {
				data: concat(encryptedChunkArray, signatureArray),
				signature: signatureArray
			};
		}
	}

	async function createDecryptionKeys(decryption, preambuleArray, password) {
		decryption.counter = new Uint8Array(COUNTER_DEFAULT_VALUE);
		const salt = preambuleArray.subarray(0, 16);
		const passwordVerification = preambuleArray.subarray(16);
		const encodedPassword = (new TextEncoder()).encode(password);
		const basekey = await crypto.subtle.importKey("raw", encodedPassword, BASE_KEY_ALGORITHM, false, DERIVED_BITS_USAGE);
		const derivedBits = await crypto.subtle.deriveBits(Object.assign({ salt }, DERIVED_BITS_ALGORITHM), basekey, DERIVED_BITS_LENGTH);
		const compositeKey = new Uint8Array(derivedBits);
		decryption.keys = {
			decryption: await crypto.subtle.importKey("raw", compositeKey.subarray(0, 32), CRYPTO_KEY_ALGORITHM, true, ["decrypt"]),
			authentication: await crypto.subtle.importKey("raw", compositeKey.subarray(32, 64), AUTHENTICATION_ALGORITHM, false, SIGN_USAGE),
			passwordVerification: compositeKey.subarray(64)
		};
		if (decryption.keys.passwordVerification[0] != passwordVerification[0] || decryption.keys.passwordVerification[1] != passwordVerification[1]) {
			throw new Error(ERR_INVALID_PASSORD);
		}
	}

	async function createEncryptionKeys(encryption, password) {
		encryption.counter = new Uint8Array(COUNTER_DEFAULT_VALUE);
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const encodedPassword = (new TextEncoder()).encode(password);
		const basekey = await crypto.subtle.importKey("raw", encodedPassword, BASE_KEY_ALGORITHM, false, DERIVED_BITS_USAGE);
		const derivedBits = await crypto.subtle.deriveBits(Object.assign({ salt }, DERIVED_BITS_ALGORITHM), basekey, DERIVED_BITS_LENGTH);
		const compositeKey = new Uint8Array(derivedBits);
		encryption.keys = {
			encryption: await crypto.subtle.importKey("raw", compositeKey.subarray(0, 32), CRYPTO_KEY_ALGORITHM, true, ["encrypt"]),
			authentication: await crypto.subtle.importKey("raw", compositeKey.subarray(32, 64), AUTHENTICATION_ALGORITHM, false, SIGN_USAGE),
			passwordVerification: compositeKey.subarray(64)
		};
		return concat(salt, encryption.keys.passwordVerification);
	}

	function incrementCounter(counter) {
		for (let indexCounter = 0; indexCounter < 16; indexCounter++) {
			if (counter[indexCounter] == 255) {
				counter[indexCounter] = 0;
			} else {
				counter[indexCounter]++;
				break;
			}
		}
	}

	function concat(leftArray, rightArray) {
		let array = leftArray;
		if (leftArray.length + rightArray.length) {
			array = new Uint8Array(leftArray.length + rightArray.length);
			array.set(leftArray, 0);
			array.set(rightArray, leftArray.length);
		}
		return array;
	}

	function expand(inputArray, length) {
		if (length && length > inputArray.length) {
			const array = inputArray;
			inputArray = new Uint8Array(length);
			inputArray.set(array, 0);
		}
		return inputArray;
	}

	globalThis.ZipDecrypt = globalThis._jzlib_Decryption = ZipDecrypt;
	globalThis.ZipEncrypt = globalThis._jzlib_Encryption = ZipEncrypt;

})(this);