package util {
	/** A function of its own in a package. */
	public function clamp(v:Number, lo:Number = 0, hi:Number = 1):Number {
		return v < lo ? lo : v > hi ? hi : v;
	}
}
