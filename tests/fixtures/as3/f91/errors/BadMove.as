package errors {
	public class BadMove extends Error {
		public var move:String;

		public function BadMove(move:String) {
			super("bad move " + move, 77);
			this.move = move;
			name = "BadMove";
		}
	}
}
