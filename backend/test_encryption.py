from core.encryption import encrypt, decrypt

original = "my_secret_password_123"
encrypted = encrypt(original)
assert encrypted != original
assert "my_secret" not in encrypted

decrypted = decrypt(encrypted)
assert decrypted == original
print("Encryption round-trip: PASS")

# Verify same input produces different ciphertext each time (Fernet uses random IV)
encrypted2 = encrypt(original)
assert encrypted != encrypted2
print("Unique ciphertext per call: PASS")