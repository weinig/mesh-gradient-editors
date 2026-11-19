// Prints whether the screen is locked. Safari draws no frames behind a locked screen.
import CoreGraphics

let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
print("locked:", session["CGSSessionScreenIsLocked"] ?? 0)
